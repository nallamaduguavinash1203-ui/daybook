import { useEffect, useMemo, useRef, useState } from "react";
import Navigation from "./components/Navigation";
import type { DaybookData } from "./services/storage";
import { loadData, saveData } from "./services/storage";
import type { Course, CourseTopic, Timetable, TimetableEntry } from "./types";
import { planCourseWithAI, type CoursePlanResponse } from "./aiCoursePlanner";
import { studyWithAI, type StudyAIResponse, type StudyMode } from "./aiStudyAssistant";
import { AnimatePresence, motion } from "framer-motion";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import mammoth from "mammoth";
import Tesseract from "tesseract.js";
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Image as ImageIcon,
  MoreHorizontal,
  Pause,
  Pencil,
  Plus,
  Save,
  Trash2,
  Target,
  Clock3,
  Bell,
  CalendarClock,
  ClipboardList,
  Upload,
  X,
  Navigation2,
  MapPin,
  Sparkles,
  Send,
  MessageCircle,
  Paperclip,
  Code2,
  Brain,
  ListChecks,
  Bug,
  FileQuestion,
} from "lucide-react";
import "./App.css";

/* =========================================================
   TYPES
========================================================= */

type CourseWithPlanning = Course & {
  dailyMinutes: number;
  weekendWeight: number;
};

interface StoredAIPlan {
  interpretation: string;
  subtopics: Array<{ id: string; parentTopic: string; title: string; minutes: number; order: number }>;
  days: Array<{ day: number; minutes: number; subtopicIds: string[] }>;
}

type ImportSource = "paste" | "txt" | "pdf" | "docx" | "image";

interface CourseFormState {
  name: string;
  type: "academic" | "non-academic";
  startDate: string;
  durationText: string;
  dailyMinutes: string;
  weekendWeight: string;
  topicsText: string;
}

interface ExamFormState {
  name: string;
  date: string;
  difficulty: "easy" | "medium" | "hard";
  courseId: string;
  topicsText: string;
}

interface GoalRecord {
  id: string;
  name: string;
  target: string;
  dailyMinutes: number;
  startDate: string;
  endDate: string | null;
  active: boolean;
}

type EventCategory = "assignment" | "submission" | "test" | "project" | "presentation" | "college" | "personal" | "other";
interface DaybookEventRecord {
  id: string;
  title: string;
  category: EventCategory;
  date: string;
  time?: string;
  notes?: string;
  reminderDays: number[];
  completed: boolean;
}
interface EventFormState {
  title: string;
  category: EventCategory;
  date: string;
  time: string;
  notes: string;
  reminderDays: number[];
}

interface GoalFormState {
  name: string;
  target: string;
  dailyMinutes: string;
  startDate: string;
  durationText: string;
}


interface TimetableReviewEntry {
  id: string;
  day: number;
  subject: string;
  room: string;
  startTime: string;
  endTime: string;
}

type TimetableReviewEntryWithId = TimetableReviewEntry;

/* =========================================================
   HELPERS
========================================================= */

function todayISO(): string {
  const date = new Date();

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function parseDurationToDays(value: string): number | null {
  const text = value.trim().toLowerCase();

  if (!text) {
    return null;
  }

  const numberMatch = text.match(/(\d+(?:\.\d+)?)/);

  if (!numberMatch) {
    return null;
  }

  const amount = Number(numberMatch[1]);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  if (
    text.includes("month") ||
    text.includes("months") ||
    text.includes("mo")
  ) {
    return Math.max(1, Math.round(amount * 30));
  }

  if (
    text.includes("week") ||
    text.includes("weeks") ||
    text.includes("wk")
  ) {
    return Math.max(1, Math.round(amount * 7));
  }

  if (
    text.includes("hour") ||
    text.includes("hours") ||
    text.includes("hr") ||
    text.includes("hrs")
  ) {
    return null;
  }

  return Math.max(1, Math.round(amount));
}

function calculateEndDate(
  startDate: string,
  durationText: string
): string | null {
  const days = parseDurationToDays(durationText);

  if (!days || !startDate) {
    return null;
  }

  const date = new Date(`${startDate}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setDate(date.getDate() + days - 1);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDate(dateString: string | null): string {
  if (!dateString) {
    return "No end date";
  }

  const date = new Date(`${dateString}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/* =========================================================
   TOPIC IMPORT HELPERS
========================================================= */

function cleanTopicLine(line: string): string {
  let value = line.trim();

  value = value.replace(
    /^\s*(?:[-•●▪◦*]+|\d+(?:\.\d+)*[\).:-]?)\s*/,
    ""
  );

  value = value.replace(/\s+/g, " ").trim();

  return value;
}

function shouldIgnoreTopic(line: string): boolean {
  const normalized = line
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return true;
  }

  if (normalized.length < 3 || normalized.length > 180) {
    return true;
  }

  const ignoredPatterns = [
    /^unit\s+[ivx\d]+$/,
    /^module\s+[ivx\d]+$/,
    /^chapter\s+[ivx\d]+$/,
    /^unit\s+[ivx\d]+:/,
    /^course outcomes?$/,
    /^course objectives?$/,
    /^learning outcomes?$/,
    /^objectives?$/,
    /^references?$/,
    /^reference books?$/,
    /^text books?$/,
    /^textbooks?$/,
    /^faculty$/,
    /^department$/,
    /^semester$/,
    /^credits?$/,
    /^course code$/,
    /^course title$/,
    /^prerequisite$/,
    /^prerequisites$/,
    /^syllabus$/,
    /^academic year$/,
    /^program$/,
  ];

  if (ignoredPatterns.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  if (
    normalized.startsWith("course outcomes") ||
    normalized.startsWith("course objective") ||
    normalized.startsWith("text book") ||
    normalized.startsWith("reference book") ||
    normalized.startsWith("prerequisite")
  ) {
    return true;
  }

  return false;
}

function extractTopicsFromText(text: string): string[] {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map(cleanTopicLine)
    .filter(Boolean);

  const topics: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (shouldIgnoreTopic(line)) {
      continue;
    }

    const normalized = line
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    topics.push(line);
  }

  return topics;
}

async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();

  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
  }).promise;

  let fullText = "";

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    const pageText = content.items
      .map((item) => {
        if ("str" in item) {
          return item.str;
        }

        return "";
      })
      .join(" ");

    fullText += `${pageText}\n`;
  }

  return fullText;
}

async function extractTextFromDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();

  const result = await mammoth.extractRawText({
    arrayBuffer,
  });

  return result.value;
}

async function extractTextFromImage(file: File): Promise<string> {
  const result = await Tesseract.recognize(file, "eng");

  return result.data.text;
}

/* =========================================================
   COURSE NORMALIZATION
========================================================= */

function normalizeCourse(course: Course): CourseWithPlanning {
  const candidate = course as CourseWithPlanning;

  return {
    ...candidate,
    dailyMinutes:
      typeof candidate.dailyMinutes === "number"
        ? candidate.dailyMinutes
        : 60,
    weekendWeight:
      typeof candidate.weekendWeight === "number"
        ? candidate.weekendWeight
        : 1,
  };
}


/* =========================================================
   TIMETABLE OCR HELPERS
========================================================= */

const WEEKDAY_MAP: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

function normalizeTimeToken(value: string): string | null {
  const cleaned = value.trim().toUpperCase().replace(/\./g, "");
  const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "00");
  const meridiem = match[3];

  if (minute > 59 || hour > 23) return null;

  if (meridiem) {
    if (hour === 12) hour = 0;
    if (meridiem === "PM") hour += 12;
  }

  if (hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseTimeRange(text: string): { startTime: string; endTime: string } | null {
  const match = text.match(
    /(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)/i
  );
  if (!match) return null;

  const start = normalizeTimeToken(match[1]);
  const end = normalizeTimeToken(match[2]);
  if (!start || !end) return null;

  return { startTime: start, endTime: end };
}

function detectDay(text: string): number | null {
  const normalized = text.toLowerCase();
  const names = Object.keys(WEEKDAY_MAP).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const pattern = new RegExp(`\\b${name}\\b`, "i");
    if (pattern.test(normalized)) return WEEKDAY_MAP[name];
  }
  return null;
}

function cleanTimetableSubject(value: string): string {
  return value
    .replace(/\b(?:sun|sunday|mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)\b/gi, " ")
    .replace(/\d{1,2}(?::\d{2})?\s*(?:AM|PM)?\s*(?:-|–|—|to)\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM)?/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[|:,\-–—\s]+|[|:,\-–—\s]+$/g, "")
    .trim();
}

function extractRoom(value: string): string {
  const roomMatch = value.match(
    /\b(?:room|rm|lab|block|classroom)\s*[:#-]?\s*([A-Za-z0-9-]+(?:\s*[A-Za-z0-9-]+)?)/i
  );
  if (roomMatch) return roomMatch[1].trim();

  const compact = value.match(/\b(?:R|B|L)\s*[-]?\s*\d{1,4}[A-Za-z]?\b/i);
  return compact ? compact[0].trim() : "";
}

function parseTimetableOCR(text: string): TimetableReviewEntryWithId[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const results: TimetableReviewEntryWithId[] = [];
  let currentDay: number | null = null;

  for (const rawLine of lines) {
    const detectedDay = detectDay(rawLine);
    if (detectedDay !== null) currentDay = detectedDay;

    const range = parseTimeRange(rawLine);
    if (!range) continue;

    const day = detectedDay ?? currentDay;
    if (day === null) continue;

    let remaining = rawLine;
    const timeMatch = rawLine.match(
      /(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)/i
    );
    if (timeMatch) remaining = rawLine.replace(timeMatch[0], " ");

    const room = extractRoom(remaining);
    const subject = cleanTimetableSubject(
      remaining.replace(/\b(?:room|rm|lab|block|classroom)\s*[:#-]?\s*[A-Za-z0-9-]+(?:\s*[A-Za-z0-9-]+)?/i, " ")
    );

    if (!subject || subject.length < 2) continue;

    results.push({
      id: makeId("tt"),
      day,
      subject,
      room,
      startTime: range.startTime,
      endTime: range.endTime,
    });
  }

  return results;
}

function timetableDayName(day: number): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day] ?? "";
}


type LiveNavigationItem = {
  id: string;
  title: string;
  subtitle: string;
  startTime: string;
  endTime: string;
  kind: "class" | "study";
  room?: string;
};

function liveMinutesFromTime(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function liveTimeFromMinutes(value: number): string {
  const safe = Math.max(0, Math.min(1439, Math.round(value)));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function buildLiveNavigationItems(
  timetable: Timetable | null,
  activeCourses: CourseWithPlanning[],
  now: Date
): LiveNavigationItem[] {
  const today = todayISO();
  const weekday = now.getDay();
  const fixed: LiveNavigationItem[] = [];

  if (timetable) {
    timetable.entries
      .filter((entry) => entry.day === weekday)
      .forEach((entry) => {
        fixed.push({
          id: `class-${entry.id}`,
          title: entry.subject,
          subtitle: entry.room ? `Class • Room ${entry.room}` : "Class",
          startTime: entry.startTime,
          endTime: entry.endTime,
          kind: "class",
          room: entry.room,
        });
      });
  }

  // Lunch is a fixed blocked period and is never presented as learning.
  fixed.push({
    id: "lunch",
    title: "Lunch",
    subtitle: "Break",
    startTime: "13:00",
    endTime: "14:00",
    kind: "class",
  });

  fixed.sort((a, b) => liveMinutesFromTime(a.startTime) - liveMinutesFromTime(b.startTime));

  const studyItems: LiveNavigationItem[] = [];
  const active = activeCourses.filter((course) => {
    if (!course.active) return false;
    if (course.startDate && course.startDate > today) return false;
    if (course.endDate && course.endDate < today) return false;
    return course.topics.some((topic) => !topic.completed) && course.dailyMinutes > 0;
  });

  const windows: Array<[number, number]> = [];
  let cursor = 8 * 60;
  const dayEnd = 22 * 60;

  for (const block of fixed) {
    const start = liveMinutesFromTime(block.startTime);
    const end = liveMinutesFromTime(block.endTime);
    if (start > cursor) windows.push([cursor, Math.min(start, dayEnd)]);
    cursor = Math.max(cursor, end);
    if (cursor >= dayEnd) break;
  }
  if (cursor < dayEnd) windows.push([cursor, dayEnd]);

  let courseIndex = 0;
  let courseRemaining = active.length > 0 ? active[0].dailyMinutes : 0;

  for (const [windowStart, windowEnd] of windows) {
    let slotCursor = windowStart;

    while (slotCursor < windowEnd && courseIndex < active.length) {
      const course = active[courseIndex];
      const remainingWindow = windowEnd - slotCursor;
      const duration = Math.min(courseRemaining, remainingWindow);
      if (duration < 15) break;

      const topic = course.topics.find((item) => !item.completed);
      studyItems.push({
        id: `study-${course.id}-${courseIndex}-${slotCursor}`,
        title: course.name,
        subtitle: topic ? `Learning • ${topic.name}` : "Learning",
        startTime: liveTimeFromMinutes(slotCursor),
        endTime: liveTimeFromMinutes(slotCursor + duration),
        kind: "study",
      });

      slotCursor += duration;
      courseRemaining -= duration;

      if (courseRemaining <= 0) {
        courseIndex += 1;
        courseRemaining = courseIndex < active.length ? active[courseIndex].dailyMinutes : 0;
      }
    }
  }

  return [...fixed.filter((item) => item.id !== "lunch"), ...studyItems]
    .sort((a, b) => liveMinutesFromTime(a.startTime) - liveMinutesFromTime(b.startTime));
}

/* =========================================================
   APP
========================================================= */

function App() {
  const [activePage, setActivePage] = useState("Today");

  const [daybookData, setDaybookData] = useState<DaybookData>(() =>
    loadData()
  );

  /* -------------------------------------------------------
     COURSE STATE
  ------------------------------------------------------- */

  const courses = useMemo(
    () => daybookData.courses.map(normalizeCourse),
    [daybookData.courses]
  );

  const [showCourseForm, setShowCourseForm] = useState(false);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(
    null
  );

  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(
    null
  );

  const [courseForm, setCourseForm] = useState<CourseFormState>({
    name: "",
    type: "academic",
    startDate: todayISO(),
    durationText: "",
    dailyMinutes: "60",
    weekendWeight: "1",
    topicsText: "",
  });

  const [courseFormError, setCourseFormError] = useState("");

  /* -------------------------------------------------------
     EXAM STATE
  ------------------------------------------------------- */

  const [showExamForm, setShowExamForm] = useState(false);
  const [editingExamId, setEditingExamId] = useState<string | null>(null);

  const [examForm, setExamForm] = useState<ExamFormState>({
    name: "",
    date: todayISO(),
    difficulty: "medium",
    courseId: "",
    topicsText: "",
  });

  const [examFormError, setExamFormError] = useState("");

  /* -------------------------------------------------------
     GOAL STATE
  ------------------------------------------------------- */

  const [showGoalForm, setShowGoalForm] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [goalForm, setGoalForm] = useState<GoalFormState>({
    name: "",
    target: "",
    dailyMinutes: "30",
    startDate: todayISO(),
    durationText: "30 days",
  });
  const [goalFormError, setGoalFormError] = useState("");

  /* -------------------------------------------------------
     EVENT STATE
  ------------------------------------------------------- */

  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventFormError, setEventFormError] = useState("");
  const [eventForm, setEventForm] = useState<EventFormState>({
    title: "", category: "assignment", date: todayISO(),
    time: "", notes: "", reminderDays: [1, 0],
  });

  /* -------------------------------------------------------
     TIMETABLE STATE
  ------------------------------------------------------- */

  const [showTimetableImporter, setShowTimetableImporter] = useState(false);
  const [timetableLoading, setTimetableLoading] = useState(false);
  const [timetableError, setTimetableError] = useState("");
  const [timetableReview, setTimetableReview] = useState<TimetableReviewEntryWithId[]>([]);
  const [timetableValidFrom, setTimetableValidFrom] = useState(todayISO());
  const [timetableValidUntil, setTimetableValidUntil] = useState("");
  const [showTimetableReview, setShowTimetableReview] = useState(false);

  /* -------------------------------------------------------
     TOPIC IMPORT STATE
  ------------------------------------------------------- */

  const [showTopicImporter, setShowTopicImporter] = useState(false);

  const [topicImportSource, setTopicImportSource] =
    useState<ImportSource>("paste");

  const [topicImportText, setTopicImportText] = useState("");

  const [topicImportLoading, setTopicImportLoading] = useState(false);

  const [topicImportError, setTopicImportError] = useState("");

  const [topicImportTargetCourseId, setTopicImportTargetCourseId] =
    useState<string | null>(null);

  const [showTopicReview, setShowTopicReview] = useState(false);

  const [reviewTopics, setReviewTopics] = useState<string[]>([]);

  const [reviewNewTopic, setReviewNewTopic] = useState("");

  /* -------------------------------------------------------
     AI COURSE PLANNER
  ------------------------------------------------------- */

  const [showAIPlanner, setShowAIPlanner] = useState(false);
  const [aiPlannerCourseId, setAIPlannerCourseId] = useState<string | null>(null);
  const [aiPlannerMessage, setAIPlannerMessage] = useState("");
  const [aiPlannerHistory, setAIPlannerHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [aiPlannerPlan, setAIPlannerPlan] = useState<CoursePlanResponse | null>(null);
  const [aiPlannerLoading, setAIPlannerLoading] = useState(false);
  const [aiPlannerError, setAIPlannerError] = useState("");

  /* -------------------------------------------------------
     AI STUDY ASSISTANT + PRACTICE
  ------------------------------------------------------- */
  const [showAIStudy, setShowAIStudy] = useState(false);
  const [aiStudyCourseId, setAIStudyCourseId] = useState<string | null>(null);
  const [aiStudyMode, setAIStudyMode] = useState<StudyMode>("chat");
  const [aiStudyMessage, setAIStudyMessage] = useState("");
  const [aiStudyHistory, setAIStudyHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [aiStudyResponse, setAIStudyResponse] = useState<StudyAIResponse | null>(null);
  const [aiStudyLoading, setAIStudyLoading] = useState(false);
  const [aiStudyError, setAIStudyError] = useState("");
  const [aiStudyAttachment, setAIStudyAttachment] = useState<{ name: string; text: string } | null>(null);
  const [aiPracticeAnswer, setAIPracticeAnswer] = useState("");
  const [aiPracticeSubmitted, setAIPracticeSubmitted] = useState(false);
  const [aiPracticeScore, setAIPracticeScore] = useState<number | null>(null);

  /* -------------------------------------------------------
     GENERAL
  ------------------------------------------------------- */

  const [liveNow, setLiveNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setLiveNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const liveNavigationItems = useMemo(
    () => buildLiveNavigationItems(daybookData.timetable, courses, liveNow),
    [daybookData.timetable, courses, liveNow]
  );

  const lastSystemNotificationKey = useRef<string>("");

  useEffect(() => {
    const nowMinutes = liveNow.getHours() * 60 + liveNow.getMinutes();
    const current = liveNavigationItems.find((item) => {
      const start = liveMinutesFromTime(item.startTime);
      const end = liveMinutesFromTime(item.endTime);
      return nowMinutes >= start && nowMinutes < end;
    });
    const next = liveNavigationItems.find(
      (item) => liveMinutesFromTime(item.startTime) > nowMinutes
    );

    if (!current && !next) return;

    const currentRemaining = current
      ? Math.max(0, liveMinutesFromTime(current.endTime) - nowMinutes)
      : Infinity;
    const showNextEarly = Boolean(current && next && currentRemaining <= 10);
    const target = showNextEarly ? next! : current ?? next!;
    const key = `${target.id}-${showNextEarly ? "next" : "now"}-${target.startTime}`;

    if (lastSystemNotificationKey.current === key) return;
    lastSystemNotificationKey.current = key;

    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

    const body = showNextEarly
      ? `${target.kind === "class" ? "Class" : "Learning"}${target.room ? ` • ${target.room}` : ""} starts at ${target.startTime}.`
      : `${target.kind === "class" ? "Class" : "Learning"}${target.room ? ` • ${target.room}` : ""} is now scheduled.`;

    new Notification(showNextEarly ? `Up next: ${target.title}` : `Now: ${target.title}`, {
      body,
      tag: "daybook-live-schedule",
    });
  }, [liveNavigationItems, liveNow]);

  const requestScheduleNotifications = async () => {
    if (typeof Notification === "undefined") {
      window.alert("This browser does not support system notifications.");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      new Notification("Daybook notifications enabled", {
        body: "You will receive schedule updates when supported by your device and browser.",
        tag: "daybook-notifications-enabled",
      });
    }
  };

  const updateDaybookData = (updatedData: DaybookData) => {
    setDaybookData(updatedData);
    saveData(updatedData);
  };

  /* =======================================================
     COURSE FUNCTIONS
  ======================================================= */

  function resetCourseForm() {
    setCourseForm({
      name: "",
      type: "academic",
      startDate: todayISO(),
      durationText: "",
      dailyMinutes: "60",
      weekendWeight: "1",
      topicsText: "",
    });

    setEditingCourseId(null);
    setCourseFormError("");
  }

  function openAddCourse() {
    resetCourseForm();
    setShowCourseForm(true);
  }

  function openEditCourse(course: CourseWithPlanning) {
    setEditingCourseId(course.id);

    const topicsText = course.topics
      .filter((topic) => !topic.completed)
      .map((topic) => topic.name)
      .join("\n");

    let durationText = "";

    if (course.startDate && course.endDate) {
      const start = new Date(`${course.startDate}T00:00:00`);
      const end = new Date(`${course.endDate}T00:00:00`);

      const difference =
        Math.round(
          (end.getTime() - start.getTime()) /
            (1000 * 60 * 60 * 24)
        ) + 1;

      if (difference > 0) {
        durationText = `${difference} days`;
      }
    }

    setCourseForm({
      name: course.name,
      type: course.type,
      startDate: course.startDate || todayISO(),
      durationText,
      dailyMinutes: String(course.dailyMinutes),
      weekendWeight: String(course.weekendWeight),
      topicsText,
    });

    setCourseFormError("");
    setShowCourseForm(true);
  }

  function saveCourse() {
    const name = courseForm.name.trim();

    if (!name) {
      setCourseFormError("Please enter a course name.");
      return;
    }

    const dailyMinutes = Number(courseForm.dailyMinutes);

    if (!Number.isFinite(dailyMinutes) || dailyMinutes <= 0) {
      setCourseFormError(
        "Daily study time must be greater than 0 minutes."
      );
      return;
    }

    const weekendWeight = Number(courseForm.weekendWeight);

    if (!Number.isFinite(weekendWeight) || weekendWeight < 0) {
      setCourseFormError("Weekend weight cannot be negative.");
      return;
    }

    const startDate = courseForm.startDate || todayISO();

    const endDate = calculateEndDate(
      startDate,
      courseForm.durationText
    );

    if (!endDate) {
      setCourseFormError(
        'Enter a duration such as "30 days", "2 months", or "6 weeks".'
      );
      return;
    }

    const topicNames = extractTopicsFromText(courseForm.topicsText);

    const topics: CourseTopic[] = topicNames.map((topic) => ({
      id: makeId("topic"),
      name: topic,
      completed: false,
    }));

    if (editingCourseId) {
      const updatedCourses = daybookData.courses.map((course) => {
        if (course.id !== editingCourseId) {
          return course;
        }

        const existingCourse = normalizeCourse(course);

        const existingTopicNames = new Set(
          existingCourse.topics.map((topic) =>
            topic.name.toLowerCase().trim()
          )
        );

        const newTopics = topics.filter(
          (topic) =>
            !existingTopicNames.has(topic.name.toLowerCase().trim())
        );

        return {
          ...existingCourse,
          name,
          type: courseForm.type,
          startDate,
          endDate,
          dailyMinutes,
          weekendWeight,
          topics: [...existingCourse.topics, ...newTopics],
        } as Course;
      });

      updateDaybookData({
        ...daybookData,
        courses: updatedCourses,
      });
    } else {
      const newCourse = {
        id: makeId("course"),
        name,
        type: courseForm.type,
        topics,
        startDate,
        endDate,
        dailyMinutes,
        weekendWeight,
        active: true,
      } as Course;

      updateDaybookData({
        ...daybookData,
        courses: [...daybookData.courses, newCourse],
      });
    }

    setShowCourseForm(false);
    resetCourseForm();
  }

  function toggleCourseActive(courseId: string) {
    const updatedCourses = daybookData.courses.map((course) => {
      if (course.id !== courseId) {
        return course;
      }

      return {
        ...course,
        active: !course.active,
      };
    });

    updateDaybookData({
      ...daybookData,
      courses: updatedCourses,
    });
  }

  function deleteCourse(courseId: string) {
    const course = courses.find((item) => item.id === courseId);

    if (!course) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${course.name}"?\n\nThis removes the course and its topics from Daybook.`
    );

    if (!confirmed) {
      return;
    }

    updateDaybookData({
      ...daybookData,
      courses: daybookData.courses.filter(
        (item) => item.id !== courseId
      ),
    });

    if (expandedCourseId === courseId) {
      setExpandedCourseId(null);
    }
  }

  function toggleTopicCompleted(
    courseId: string,
    topicId: string
  ) {
    const updatedCourses = daybookData.courses.map((course) => {
      if (course.id !== courseId) {
        return course;
      }

      return {
        ...course,
        topics: course.topics.map((topic) =>
          topic.id === topicId
            ? {
                ...topic,
                completed: !topic.completed,
              }
            : topic
        ),
      };
    });

    updateDaybookData({
      ...daybookData,
      courses: updatedCourses,
    });
  }

  /* =======================================================
     AI COURSE PLANNER
  ======================================================= */

  function openAIPlanner(courseId: string) {
    const course = courses.find((item) => item.id === courseId);
    if (!course) return;

    setAIPlannerCourseId(courseId);
    setAIPlannerMessage("");
    setAIPlannerHistory([]);
    setAIPlannerPlan(null);
    setAIPlannerError("");
    setShowAIPlanner(true);
  }

  function closeAIPlanner() {
    if (aiPlannerLoading) return;
    setShowAIPlanner(false);
    setAIPlannerCourseId(null);
    setAIPlannerMessage("");
    setAIPlannerHistory([]);
    setAIPlannerPlan(null);
    setAIPlannerError("");
  }

  async function sendAIPlannerMessage() {
    const message = aiPlannerMessage.trim();
    const course = courses.find((item) => item.id === aiPlannerCourseId);
    if (!course || !message || aiPlannerLoading) return;

    setAIPlannerLoading(true);
    setAIPlannerError("");
    const nextHistory = [...aiPlannerHistory, { role: "user" as const, content: message }];
    setAIPlannerHistory(nextHistory);
    setAIPlannerMessage("");

    try {
      const plan = await planCourseWithAI({
        courseName: course.name,
        courseType: course.type,
        startDate: course.startDate,
        endDate: course.endDate ?? course.startDate,
        dailyMinutes: course.dailyMinutes,
        weekendWeight: course.weekendWeight,
        topics: course.topics.map((topic) => topic.name),
        userMessage: message,
        history: aiPlannerHistory,
      });

      setAIPlannerPlan(plan);
      setAIPlannerHistory((current) => [
        ...current,
        { role: "assistant", content: plan.assistantMessage },
      ]);
    } catch (error) {
      setAIPlannerHistory((current) => current.filter((_, index) => index !== current.length - 1));
      setAIPlannerError(error instanceof Error ? error.message : "AI course planning failed.");
    } finally {
      setAIPlannerLoading(false);
    }
  }

  function applyAIPlanTopics() {
    const course = courses.find((item) => item.id === aiPlannerCourseId);
    if (!course || !aiPlannerPlan) return;

    const existing = new Set(course.topics.map((topic) => topic.name.trim().toLowerCase()));
    const additions: CourseTopic[] = aiPlannerPlan.subtopics
      .map((subtopic) => subtopic.title.trim())
      .filter((name) => name && !existing.has(name.toLowerCase()))
      .map((name) => ({ id: makeId("topic"), name, completed: false }));

    const storedPlan: StoredAIPlan = {
      interpretation: aiPlannerPlan.interpretation,
      subtopics: aiPlannerPlan.subtopics,
      days: aiPlannerPlan.days,
    };

    const updatedCourses = daybookData.courses.map((item) =>
      item.id === course.id
        ? { ...item, topics: [...item.topics, ...additions], aiPlan: storedPlan }
        : item
    );

    updateDaybookData({ ...daybookData, courses: updatedCourses });
    closeAIPlanner();
  }

  /* =======================================================
     AI STUDY ASSISTANT + PRACTICE
  ======================================================= */
  function openAIStudy(courseId: string, mode: StudyMode = "chat") {
    const course = courses.find((item) => item.id === courseId);
    if (!course) return;
    setAIStudyCourseId(courseId);
    setAIStudyMode(mode);
    setAIStudyMessage("");
    setAIStudyHistory([]);
    setAIStudyResponse(null);
    setAIStudyError("");
    setAIStudyAttachment(null);
    setAIPracticeAnswer("");
    setAIPracticeSubmitted(false);
    setAIPracticeScore(null);
    setShowAIStudy(true);
  }

  function closeAIStudy() {
    if (aiStudyLoading) return;
    setShowAIStudy(false);
    setAIStudyCourseId(null);
    setAIStudyAttachment(null);
    setAIStudyResponse(null);
    setAIStudyHistory([]);
  }

  async function prepareStudyAttachment(file: File) {
    setAIStudyError("");
    try {
      let text = "";
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (extension === "pdf") text = await extractTextFromPdf(file);
      else if (extension === "docx" || file.type.includes("wordprocessingml.document")) text = await extractTextFromDocx(file);
      else if (extension === "txt" || file.type.startsWith("text/")) text = await file.text();
      else if (file.type.startsWith("image/")) text = await extractTextFromImage(file);
      else throw new Error("Use PDF, DOCX, TXT, or an image.");
      if (!text.trim()) throw new Error("I could not extract readable text from that file.");
      setAIStudyAttachment({ name: file.name, text: text.slice(0, 50000) });
    } catch (error) {
      setAIStudyError(error instanceof Error ? error.message : "Could not read that file.");
    }
  }

  async function sendAIStudyMessage(mode: StudyMode = aiStudyMode, messageOverride?: string) {
    const course = courses.find((item) => item.id === aiStudyCourseId);
    const message = (messageOverride ?? aiStudyMessage).trim();
    if (!course || aiStudyLoading) return;
    const prompt = message || (mode === "mcq" ? "Give me one multiple-choice question from this course." : mode === "coding" ? "Give me one coding problem appropriate for this course." : mode === "debug" ? "Give me one debugging problem from this course." : mode === "short-answer" ? "Give me one short-answer question from this course." : "Help me study this course.");
    setAIStudyLoading(true);
    setAIStudyError("");
    setAIStudyMode(mode);
    setAIStudyResponse(null);
    setAIPracticeSubmitted(false);
    setAIPracticeScore(null);
    setAIPracticeAnswer("");
    const nextHistory = [...aiStudyHistory, { role: "user" as const, content: prompt }];
    setAIStudyHistory(nextHistory);
    setAIStudyMessage("");
    try {
      const response = await studyWithAI({
        courseName: course.name,
        courseType: course.type,
        topics: course.topics.map((topic) => topic.name),
        currentPlan: (course as CourseWithPlanning & { aiPlan?: StoredAIPlan }).aiPlan ?? null,
        mode,
        userMessage: prompt,
        history: aiStudyHistory,
        attachmentName: aiStudyAttachment?.name,
        attachmentText: aiStudyAttachment?.text,
      });
      setAIStudyResponse(response);
      setAIStudyHistory((current) => [...current, { role: "assistant", content: response.assistantMessage }]);
    } catch (error) {
      setAIStudyHistory((current) => current.slice(0, -1));
      setAIStudyError(error instanceof Error ? error.message : "AI study assistant failed.");
    } finally {
      setAIStudyLoading(false);
    }
  }

  async function submitAIPractice() {
    if (!aiStudyResponse?.practice || !aiPracticeAnswer.trim() || aiStudyLoading) return;
    const question = aiStudyResponse.practice;
    const course = courses.find((item) => item.id === aiStudyCourseId);
    if (!course) return;
    setAIStudyLoading(true);
    setAIStudyError("");
    setAIPracticeSubmitted(true);
    try {
      const response = await studyWithAI({
        courseName: course.name,
        courseType: course.type,
        topics: course.topics.map((topic) => topic.name),
        currentPlan: (course as CourseWithPlanning & { aiPlan?: StoredAIPlan }).aiPlan ?? null,
        mode: "evaluate",
        userMessage: `Evaluate my answer to this practice question. Question: ${question.question}\nExpected type: ${question.type}\nMy answer:\n${aiPracticeAnswer}`,
        history: aiStudyHistory,
        practice: question,
        answer: aiPracticeAnswer,
      });
      setAIStudyResponse(response);
      setAIStudyHistory((current) => [...current, { role: "assistant", content: response.assistantMessage }]);
      setAIPracticeScore(response.practice?.score ?? null);
    } catch (error) {
      setAIStudyError(error instanceof Error ? error.message : "Could not evaluate the answer.");
      setAIPracticeSubmitted(false);
    } finally {
      setAIStudyLoading(false);
    }
  }

  /* =======================================================
     TOPIC IMPORT
  ======================================================= */

  function openTopicImporter(courseId: string) {
    setTopicImportTargetCourseId(courseId);
    setTopicImportText("");
    setTopicImportError("");
    setTopicImportSource("paste");
    setReviewTopics([]);
    setShowTopicImporter(true);
  }

  function closeTopicImporter() {
    if (topicImportLoading) {
      return;
    }

    setShowTopicImporter(false);
    setTopicImportText("");
    setTopicImportError("");
    setTopicImportTargetCourseId(null);
  }

  async function processTopicImport(file?: File) {
    setTopicImportError("");

    try {
      setTopicImportLoading(true);

      let text = topicImportText;

      if (file) {
        const extension = file.name
          .split(".")
          .pop()
          ?.toLowerCase();

        if (extension === "txt") {
          text = await file.text();
        } else if (extension === "pdf") {
          text = await extractTextFromPdf(file);
        } else if (
          extension === "docx" ||
          file.type.includes(
            "wordprocessingml.document"
          )
        ) {
          text = await extractTextFromDocx(file);
        } else if (file.type.startsWith("image/")) {
          text = await extractTextFromImage(file);
        } else {
          throw new Error(
            "Unsupported file. Use TXT, PDF, DOCX or an image."
          );
        }
      }

      const extractedTopics = extractTopicsFromText(text);

      if (extractedTopics.length === 0) {
        throw new Error(
          "No useful topics were detected. Try pasting the syllabus text or uploading a clearer file."
        );
      }

      setReviewTopics(extractedTopics);
      setShowTopicImporter(false);
      setShowTopicReview(true);
    } catch (error) {
      console.error(error);

      setTopicImportError(
        error instanceof Error
          ? error.message
          : "Something went wrong while importing topics."
      );
    } finally {
      setTopicImportLoading(false);
    }
  }

  function processPastedTopics() {
    processTopicImport();
  }

  function removeReviewTopic(index: number) {
    setReviewTopics((current) =>
      current.filter((_, topicIndex) => topicIndex !== index)
    );
  }

  function updateReviewTopic(
    index: number,
    value: string
  ) {
    setReviewTopics((current) =>
      current.map((topic, topicIndex) =>
        topicIndex === index ? value : topic
      )
    );
  }

  function addReviewTopic() {
    const value = reviewNewTopic.trim();

    if (!value) {
      return;
    }

    const duplicate = reviewTopics.some(
      (topic) =>
        topic.toLowerCase().trim() === value.toLowerCase()
    );

    if (duplicate) {
      setReviewNewTopic("");
      return;
    }

    setReviewTopics((current) => [...current, value]);
    setReviewNewTopic("");
  }

  function confirmImportedTopics() {
    if (!topicImportTargetCourseId) {
      return;
    }

    const cleanTopics = reviewTopics
      .map((topic) => topic.trim())
      .filter(Boolean);

    const updatedCourses = daybookData.courses.map((course) => {
      if (course.id !== topicImportTargetCourseId) {
        return course;
      }

      const existingNames = new Set(
        course.topics.map((topic) =>
          topic.name.toLowerCase().trim()
        )
      );

      const importedTopics: CourseTopic[] = cleanTopics
        .filter(
          (topic) =>
            !existingNames.has(topic.toLowerCase().trim())
        )
        .map((topic) => ({
          id: makeId("topic"),
          name: topic,
          completed: false,
        }));

      return {
        ...course,
        topics: [...course.topics, ...importedTopics],
      };
    });

    updateDaybookData({
      ...daybookData,
      courses: updatedCourses,
    });

    setShowTopicReview(false);
    setReviewTopics([]);
    setTopicImportTargetCourseId(null);
  }

  type TodayScheduleBlock = {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    kind: "class" | "study" | "free" | "blocked";
    subtitle: string;
    room?: string;
  };

  function scheduleMinutes(value: string): number {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  }

  function scheduleTime(value: number): string {
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  }

  function dateDiff(from: string, to: string): number {
    return Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000);
  }

  function buildTodaySchedule(): TodayScheduleBlock[] {
    const today = todayISO();
    const weekday = new Date(`${today}T12:00:00`).getDay();
    const data = daybookData as unknown as { timetable?: { entries?: TimetableEntry[] } | null };
    const fixed: TodayScheduleBlock[] = (data.timetable?.entries ?? [])
      .filter((entry) => entry.day === weekday)
      .map((entry) => ({
        id: `class-${entry.id}`,
        title: entry.subject,
        startTime: entry.startTime,
        endTime: entry.endTime,
        kind: "class",
        subtitle: "Class",
        room: entry.room,
      }));

    fixed.push({
      id: "lunch", title: "Lunch", startTime: "13:00", endTime: "14:00",
      kind: "blocked", subtitle: "Blocked time"
    });

    const occupied = fixed.map((b) => ({ start: scheduleMinutes(b.startTime), end: scheduleMinutes(b.endTime) }));
    const windows: Array<{ start: number; end: number }> = [];
    let cursor = 8 * 60;
    const dayEnd = 22 * 60;
    for (const block of [...occupied].sort((a, b) => a.start - b.start)) {
      if (block.end <= cursor || block.start >= dayEnd) continue;
      if (block.start > cursor) windows.push({ start: cursor, end: Math.min(block.start, dayEnd) });
      cursor = Math.max(cursor, block.end);
    }
    if (cursor < dayEnd) windows.push({ start: cursor, end: dayEnd });

    type Work = { title: string; minutes: number; subtitle: string };
    const work: Work[] = [];
    for (const course of courses.filter((item) => item.active)) {
      if (course.startDate > today || (course.endDate && course.endDate < today)) continue;
      const rawCourse = course as CourseWithPlanning & { aiPlan?: StoredAIPlan };
      const aiPlan = rawCourse.aiPlan;
      const planDay = aiPlan ? dateDiff(course.startDate, today) + 1 : 0;
      const planned = aiPlan?.days.find((day) => day.day === planDay);
      if (planned) {
        const plan = aiPlan;
        if (plan) {
          const units = planned.subtopicIds
            .map((id) => plan.subtopics.find((item) => item.id === id))
            .filter(Boolean) as StoredAIPlan["subtopics"];
          if (units.length) {
            for (const unit of units) work.push({ title: unit.title, minutes: unit.minutes, subtitle: course.name });
            continue;
          }
        }
      }
      const remaining = course.topics.find((topic) => !topic.completed);
      if (remaining) work.push({ title: course.name, minutes: course.dailyMinutes, subtitle: remaining.name });
    }

    const study: TodayScheduleBlock[] = [];
    let wi = 0;
    let pos = windows[0]?.start ?? 0;
    for (const item of work) {
      let remaining = item.minutes;
      while (remaining > 0 && wi < windows.length) {
        const window = windows[wi];
        pos = Math.max(pos, window.start);
        const capacity = window.end - pos;
        if (capacity <= 0) { wi++; pos = windows[wi]?.start ?? 0; continue; }
        const allocation = Math.min(remaining, capacity);
        if (allocation < 15 && capacity >= 15) { wi++; pos = windows[wi]?.start ?? 0; continue; }
        study.push({ id: `study-${item.title}-${pos}`, title: item.title, startTime: scheduleTime(pos), endTime: scheduleTime(pos + allocation), kind: "study", subtitle: item.subtitle });
        pos += allocation; remaining -= allocation;
        if (pos >= window.end) { wi++; pos = windows[wi]?.start ?? 0; }
      }
    }

    const combined = [...fixed, ...study].sort((a, b) => scheduleMinutes(a.startTime) - scheduleMinutes(b.startTime));
    const timeline: TodayScheduleBlock[] = [];
    let previous = 8 * 60;
    for (const block of combined) {
      const start = scheduleMinutes(block.startTime);
      if (start > previous) timeline.push({ id: `free-${previous}`, title: "FREE", startTime: scheduleTime(previous), endTime: block.startTime, kind: "free", subtitle: "No work assigned" });
      timeline.push(block);
      previous = Math.max(previous, scheduleMinutes(block.endTime));
    }
    if (previous < dayEnd) timeline.push({ id: `free-${previous}`, title: "FREE", startTime: scheduleTime(previous), endTime: scheduleTime(dayEnd), kind: "free", subtitle: "No work assigned" });
    return timeline;
  }

  /* =======================================================
     TODAY
  ======================================================= */

  function renderToday() {
    const schedule = buildTodaySchedule();
    const activeCourses = courses.filter((course) => course.active);
    const totalTopics = activeCourses.reduce((total, course) => total + course.topics.length, 0);
    const completedTopics = activeCourses.reduce((total, course) => total + course.topics.filter((topic) => topic.completed).length, 0);
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    const current = schedule.find((block) => nowMinutes >= scheduleMinutes(block.startTime) && nowMinutes < scheduleMinutes(block.endTime));

    return (
      <div className="page-content">
        <div className="page-header">
          <div><p className="page-eyebrow">TODAY</p><h1>Good morning, Avinash.</h1><p className="page-subtitle">Your day, arranged around fixed commitments and required course work.</p></div>
          <div className="date-pill">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}</div>
        </div>
        <div className="dashboard-grid">
          <motion.div className="focus-card" whileHover={{ y: -2 }}><div className="focus-card-content"><span className="card-label">RIGHT NOW</span><h2>{current?.title ?? "FREE"}</h2><p>{current?.subtitle ?? "Nothing is assigned right now."}</p>{current && <span className="now-time">{current.startTime} – {current.endTime}</span>}</div></motion.div>
          <motion.div className="welcome-card" whileHover={{ y: -2 }}><div><span className="card-label">TODAY&apos;S PLAN</span><h2>{schedule.filter((b) => b.kind === "study").reduce((sum, b) => sum + scheduleMinutes(b.endTime) - scheduleMinutes(b.startTime), 0)} minutes of course work</h2><p>Fixed classes first. AI-planned course work next. Remaining time stays free.</p></div></motion.div>
        </div>
        <div className="section-header"><div><span className="card-label">TODAY&apos;S OVERVIEW</span><h2>Daybook status</h2></div></div>
        <div className="dashboard-grid"><div className="card"><span className="card-label">ACTIVE COURSES</span><h3>{activeCourses.length}</h3><p>Courses currently contributing work.</p></div><div className="card"><span className="card-label">TOPIC PROGRESS</span><h3>{completedTopics} / {totalTopics}</h3><p>Completed topics across active courses.</p></div></div>
        <div className="section-header"><div><span className="card-label">TODAY&apos;S TIMELINE</span><h2>Full Day</h2></div></div>
        <div className="today-schedule-list">
          {schedule.map((block) => <motion.div key={block.id} className={`today-schedule-row ${block.kind}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}><div className="today-schedule-time">{block.startTime}<span>{block.endTime}</span></div><div className="today-schedule-main"><strong>{block.title}</strong><span>{block.subtitle}{block.room ? ` • Room ${block.room}` : ""}</span></div><div className="today-schedule-duration">{scheduleMinutes(block.endTime) - scheduleMinutes(block.startTime)}m</div></motion.div>)}
        </div>
      </div>
    );
  }

  /* =======================================================
     TIMETABLE
  ======================================================= */

  function openTimetableImporter() {
    setTimetableError("");
    setTimetableValidFrom(daybookData.timetable?.validFrom ?? todayISO());
    setTimetableValidUntil(daybookData.timetable?.validUntil ?? "");
    setShowTimetableImporter(true);
  }

  async function processTimetableImage(file: File) {
    setTimetableLoading(true);
    setTimetableError("");

    try {
      const result = await Tesseract.recognize(file, "eng", {
        logger: (message) => {
          if (message.status === "recognizing text") {
            // Tesseract progress is intentionally kept internal to avoid
            // making the review UI jump while OCR is running.
          }
        },
      });

      const entries = parseTimetableOCR(result.data.text);

      if (entries.length === 0) {
        setTimetableError(
          "Daybook could not confidently detect timetable rows. Try a clearer image, or use a photo taken straight from above."
        );
        return;
      }

      setTimetableReview(entries);
      setShowTimetableImporter(false);
      setShowTimetableReview(true);
    } catch (error) {
      console.error(error);
      setTimetableError("Could not read this image. Please try another timetable photo.");
    } finally {
      setTimetableLoading(false);
    }
  }

  function updateTimetableReview(
    id: string,
    field: keyof TimetableReviewEntry,
    value: string | number
  ) {
    setTimetableReview((current) =>
      current.map((entry) =>
        entry.id === id ? { ...entry, [field]: value } : entry
      )
    );
  }

  function removeTimetableReviewEntry(id: string) {
    setTimetableReview((current) =>
      current.filter((entry) => entry.id !== id)
    );
  }

  function addTimetableReviewEntry() {
    setTimetableReview((current) => [
      ...current,
      {
        id: makeId("tt"),
        day: 1,
        subject: "",
        room: "",
        startTime: "09:00",
        endTime: "10:00",
      },
    ]);
  }

  function confirmTimetable() {
    const cleanedEntries = timetableReview
      .filter(
        (entry) =>
          entry.subject.trim() &&
          entry.startTime &&
          entry.endTime
      )
      .map((entry) => ({
        ...entry,
        subject: entry.subject.trim(),
        room: entry.room.trim(),
      }));

    if (cleanedEntries.length === 0) {
      setTimetableError("Add at least one valid timetable entry.");
      return;
    }

    const timetable: Timetable = {
      id: daybookData.timetable?.id ?? makeId("timetable"),
      validFrom: timetableValidFrom || todayISO(),
      validUntil: timetableValidUntil,
      entries: cleanedEntries as TimetableEntry[],
    };

    updateDaybookData({
      ...daybookData,
      timetable,
    });

    setShowTimetableReview(false);
    setTimetableReview([]);
    setTimetableError("");
  }

  function renderTimetable() {
    const timetable = daybookData.timetable;

    const entries = timetable
      ? [...timetable.entries].sort((a, b) =>
          a.day - b.day || a.startTime.localeCompare(b.startTime)
        )
      : [];

    return (
      <div className="page-content">
        <div className="page-header">
          <div>
            <p className="page-eyebrow">SCHEDULE</p>
            <h1>Timetable</h1>
            <p className="page-subtitle">
              Upload your college timetable once. Daybook uses it as the fixed part of your weekly schedule.
            </p>
          </div>

          <button className="primary-button" onClick={openTimetableImporter}>
            <Upload size={17} />
            {timetable ? "Replace Timetable" : "Upload Timetable"}
          </button>
        </div>

        {timetable ? (
          <>
            <div className="timetable-status-card card">
              <div>
                <span className="card-label">ACTIVE TIMETABLE</span>
                <h2>{entries.length} classes detected</h2>
                <p>
                  Valid from {formatDate(timetable.validFrom)}
                  {timetable.validUntil ? ` to ${formatDate(timetable.validUntil)}` : " • no end date set"}
                </p>
              </div>
              <div className="timetable-status-pill">
                <span />
                Active
              </div>
            </div>

            <div className="timetable-grid">
              {entries.length === 0 ? (
                <div className="empty-state small">
                  <p>No timetable entries found.</p>
                </div>
              ) : (
                [1, 2, 3, 4, 5, 6].map((day) => {
                  const dayEntries = entries.filter((entry) => entry.day === day);
                  return (
                    <motion.div key={day} className="timetable-day-card card" layout>
                      <div className="timetable-day-heading">
                        <div>
                          <span className="card-label">WEEKLY</span>
                          <h3>{timetableDayName(day)}</h3>
                        </div>
                        <span>{dayEntries.length}</span>
                      </div>

                      {dayEntries.length === 0 ? (
                        <p className="timetable-free">No classes</p>
                      ) : (
                        <div className="timetable-entry-list">
                          {dayEntries.map((entry) => (
                            <div className="timetable-entry" key={entry.id}>
                              <div className="timetable-time">
                                {entry.startTime} – {entry.endTime}
                              </div>
                              <div>
                                <strong>{entry.subject}</strong>
                                {entry.room && <span>{entry.room}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <CalendarDays size={32} />
            <h2>No timetable added</h2>
            <p>
              Upload a clear timetable photo. Daybook will extract only the day, time, subject and room, then let you review everything before saving.
            </p>
            <button className="primary-button" onClick={openTimetableImporter}>
              <Upload size={17} />
              Upload Timetable Photo
            </button>
          </div>
        )}
      </div>
    );
  }

  /* =======================================================
     EXAMS
  ======================================================= */

  function resetExamForm() {
    setExamForm({
      name: "",
      date: todayISO(),
      difficulty: "medium",
      courseId: "",
      topicsText: "",
    });

    setEditingExamId(null);
    setExamFormError("");
  }

  function openAddExam() {
    resetExamForm();
    setShowExamForm(true);
  }

  function openEditExam(exam: (typeof daybookData.exams)[number]) {
    setEditingExamId(exam.id);

    setExamForm({
      name: exam.name,
      date: exam.date,
      difficulty: exam.difficulty ?? "medium",
      courseId: exam.courseId ?? "",
      topicsText: exam.topics.join("\n"),
    });

    setExamFormError("");
    setShowExamForm(true);
  }

  function saveExam() {
    const name = examForm.name.trim();

    if (!name) {
      setExamFormError("Please enter an exam name.");
      return;
    }

    if (!examForm.date) {
      setExamFormError("Please select the exam date.");
      return;
    }

    const topics = extractTopicsFromText(examForm.topicsText);

    if (editingExamId) {
      const updatedExams = daybookData.exams.map((exam) => {
        if (exam.id !== editingExamId) {
          return exam;
        }

        return {
          ...exam,
          name,
          date: examForm.date,
          difficulty: examForm.difficulty,
          courseId: examForm.courseId || undefined,
          topics,
        };
      });

      updateDaybookData({
        ...daybookData,
        exams: updatedExams,
      });
    } else {
      const newExam = {
        id: makeId("exam"),
        name,
        date: examForm.date,
        difficulty: examForm.difficulty,
        courseId: examForm.courseId || undefined,
        topics,
      };

      updateDaybookData({
        ...daybookData,
        exams: [...daybookData.exams, newExam],
      });
    }

    setShowExamForm(false);
    resetExamForm();
  }

  function deleteExam(examId: string) {
    const exam = daybookData.exams.find(
      (item) => item.id === examId
    );

    if (!exam) {
      return;
    }

    if (!window.confirm(`Delete "${exam.name}"?`)) {
      return;
    }

    updateDaybookData({
      ...daybookData,
      exams: daybookData.exams.filter(
        (item) => item.id !== examId
      ),
    });
  }

  function renderExams() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const getDaysRemaining = (dateString: string) => {
    const examDate = new Date(`${dateString}T00:00:00`);
    examDate.setHours(0, 0, 0, 0);

    return Math.ceil(
      (examDate.getTime() - today.getTime()) /
        (1000 * 60 * 60 * 24)
    );
  };

  const formatExamDate = (dateString: string) => {
    const date = new Date(`${dateString}T00:00:00`);

    return date.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const sortedExams = [...daybookData.exams].sort(
    (a, b) =>
      new Date(`${a.date}T00:00:00`).getTime() -
      new Date(`${b.date}T00:00:00`).getTime()
  );

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <p className="page-eyebrow">
            ACADEMICS
          </p>

          <h1>Exams</h1>

          <p className="page-subtitle">
            Track exams and preparation deadlines.
          </p>
        </div>

        <button
          className="primary-button"
          onClick={openAddExam}
        >
          <Plus size={17} />
          Add Exam
        </button>
      </div>

      {sortedExams.length === 0 ? (
        <div className="empty-state">
          <FileText size={32} />

          <h2>No exams added</h2>

          <p>
            Add your upcoming exams so Daybook can
            account for their preparation deadlines.
          </p>

          <button
            className="primary-button"
            onClick={openAddExam}
          >
            <Plus size={17} />
            Add Your First Exam
          </button>
        </div>
      ) : (
        <div className="course-list">
          {sortedExams.map((exam) => {
            const daysRemaining =
              getDaysRemaining(exam.date);

            const linkedCourse = exam.courseId
              ? courses.find(
                  (course) =>
                    course.id === exam.courseId
                )
              : undefined;

            return (
              <motion.div
                key={exam.id}
                className="card"
                layout
                whileHover={{
                  y: -2,
                }}
              >
                <div className="course-card-header">
                  <div className="course-title-area">
                    <div className="course-icon">
                      <FileText size={19} />
                    </div>

                    <div>
                      <div className="course-title-row">
                        <h3>
                          {exam.name}
                        </h3>

                        {exam.difficulty && (
                          <span
                            className={`course-type-badge ${
                              exam.difficulty ===
                              "hard"
                                ? "academic"
                                : "non-academic"
                            }`}
                          >
                            {exam.difficulty}
                          </span>
                        )}
                      </div>

                      <p>
                        {formatExamDate(
                          exam.date
                        )}

                        {linkedCourse &&
                          ` • ${linkedCourse.name}`}
                      </p>
                    </div>
                  </div>

                  <div className="course-actions">
                    <button
                      className="icon-button"
                      title="Edit exam"
                      onClick={() =>
                        openEditExam(exam)
                      }
                    >
                      <Pencil size={16} />
                    </button>

                    <button
                      className="icon-button danger"
                      title="Delete exam"
                      onClick={() =>
                        deleteExam(
                          exam.id
                        )
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div
                  className={`exam-countdown ${
                    daysRemaining <= 3
                      ? "urgent"
                      : daysRemaining <= 7
                      ? "soon"
                      : ""
                  }`}
                >
                  {daysRemaining > 0 ? (
                    <>
                      <strong>
                        {daysRemaining}
                      </strong>

                      <span>
                        days remaining
                      </span>
                    </>
                  ) : daysRemaining === 0 ? (
                    <>
                      <strong>
                        Today
                      </strong>

                      <span>
                        Exam day
                      </span>
                    </>
                  ) : (
                    <>
                      <strong>
                        Completed
                      </strong>

                      <span>
                        Exam date has passed
                      </span>
                    </>
                  )}
                </div>

                {exam.topics.length > 0 && (
                  <div className="exam-topic-preview">
                    <span className="card-label">
                      EXAM TOPICS
                    </span>

                    <div className="exam-topic-chips">
                      {exam.topics.map(
                        (topic) => (
                          <span
                            key={topic}
                          >
                            {topic}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

  /* =======================================================
     COURSES
  ======================================================= */

  function renderCourses() {
    return (
      <div className="page-content">
        <div className="page-header">
          <div>
            <p className="page-eyebrow">LEARNING</p>

            <h1>Courses</h1>

            <p className="page-subtitle">
              Manage your academic and non-academic courses.
            </p>
          </div>

          <button
            className="primary-button"
            onClick={openAddCourse}
          >
            <Plus size={17} />
            Add Course
          </button>
        </div>

        {courses.length === 0 ? (
          <div className="empty-state">
            <BookOpen size={32} />

            <h2>No courses added</h2>

            <p>
              Add your first course and import its topics
              from a syllabus, PDF, DOCX or image.
            </p>

            <button
              className="primary-button"
              onClick={openAddCourse}
            >
              <Plus size={17} />
              Add Your First Course
            </button>
          </div>
        ) : (
          <div className="course-list">
            {courses.map((course) => {
              const completedTopics =
                course.topics.filter(
                  (topic) => topic.completed
                ).length;

              const progress =
                course.topics.length === 0
                  ? 0
                  : Math.round(
                      (completedTopics /
                        course.topics.length) *
                        100
                    );

              const isExpanded =
                expandedCourseId === course.id;

              return (
                <motion.div
                  key={course.id}
                  className="course-card card"
                  layout
                  transition={{
                    duration: 0.2,
                  }}
                >
                  <div className="course-card-header">
                    <div className="course-title-area">
                      <div className="course-icon">
                        <BookOpen size={19} />
                      </div>

                      <div>
                        <div className="course-title-row">
                          <h3>{course.name}</h3>

                          <span
                            className={`course-type-badge ${
                              course.type
                            }`}
                          >
                            {course.type ===
                            "academic"
                              ? "Academic"
                              : "Non-academic"}
                          </span>

                          {!course.active && (
                            <span className="course-paused-badge">
                              Paused
                            </span>
                          )}
                        </div>

                        <p>
                          {course.dailyMinutes} min/day
                          {" • "}
                          {formatDate(
                            course.startDate
                          )}
                          {" → "}
                          {formatDate(
                            course.endDate
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="course-actions">
                      <button
                        className="icon-button"
                        title="Edit course"
                        onClick={() =>
                          openEditCourse(course)
                        }
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        className="icon-button"
                        title={
                          course.active
                            ? "Pause course"
                            : "Resume course"
                        }
                        onClick={() =>
                          toggleCourseActive(
                            course.id
                          )
                        }
                      >
                        {course.active ? (
                          <Pause size={16} />
                        ) : (
                          <Check size={16} />
                        )}
                      </button>

                      <button
                        className="icon-button danger"
                        title="Delete course"
                        onClick={() =>
                          deleteCourse(course.id)
                        }
                      >
                        <Trash2 size={16} />
                      </button>

                      <button
                        className="icon-button"
                        title={
                          isExpanded
                            ? "Collapse"
                            : "Expand"
                        }
                        onClick={() =>
                          setExpandedCourseId(
                            isExpanded
                              ? null
                              : course.id
                          )
                        }
                      >
                        {isExpanded ? (
                          <ChevronUp size={17} />
                        ) : (
                          <ChevronDown size={17} />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="course-progress">
                    <div className="progress-info">
                      <span>
                        {completedTopics} of{" "}
                        {course.topics.length} topics
                      </span>

                      <span>{progress}%</span>
                    </div>

                    <div className="progress-track">
                      <motion.div
                        className="progress-fill"
                        initial={{
                          width: 0,
                        }}
                        animate={{
                          width: `${progress}%`,
                        }}
                        transition={{
                          duration: 0.5,
                          ease: "easeOut",
                        }}
                      />
                    </div>
                  </div>

                  <div className="course-quick-actions">
                    <button
                      className="secondary-button"
                      onClick={() =>
                        openTopicImporter(
                          course.id
                        )
                      }
                    >
                      <Upload size={16} />
                      Import Topics
                    </button>

                    <button
                      className="ai-course-button"
                      onClick={() => openAIPlanner(course.id)}
                    >
                      <Sparkles size={16} />
                      Plan with AI
                    </button>

                    <button
                      className="secondary-button ai-study-button"
                      onClick={() => openAIStudy(course.id)}
                    >
                      <Brain size={16} />
                      Study & Practice
                    </button>

                    <button
                      className="secondary-button"
                      onClick={() =>
                        setExpandedCourseId(
                          isExpanded
                            ? null
                            : course.id
                        )
                      }
                    >
                      <MoreHorizontal size={16} />
                      {isExpanded
                        ? "Hide Topics"
                        : "View Topics"}
                    </button>
                  </div>

                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        className="course-topic-section"
                        initial={{
                          opacity: 0,
                          height: 0,
                        }}
                        animate={{
                          opacity: 1,
                          height: "auto",
                        }}
                        exit={{
                          opacity: 0,
                          height: 0,
                        }}
                        transition={{
                          duration: 0.2,
                        }}
                      >
                        {course.topics.length === 0 ? (
                          <div className="course-no-topics">
                            <p>
                              No topics added yet.
                            </p>

                            <button
                              className="secondary-button"
                              onClick={() =>
                                openTopicImporter(
                                  course.id
                                )
                              }
                            >
                              <Upload size={16} />
                              Import Topics
                            </button>
                          </div>
                        ) : (
                          <div className="topic-list">
                            {course.topics.map(
                              (topic, index) => (
                                <motion.div
                                  key={topic.id}
                                  className={`topic-row ${
                                    topic.completed
                                      ? "completed"
                                      : ""
                                  }`}
                                  initial={{
                                    opacity: 0,
                                    y: 5,
                                  }}
                                  animate={{
                                    opacity: 1,
                                    y: 0,
                                  }}
                                  transition={{
                                    delay:
                                      index *
                                      0.015,
                                  }}
                                >
                                  <button
                                    className={`topic-check ${
                                      topic.completed
                                        ? "checked"
                                        : ""
                                    }`}
                                    onClick={() =>
                                      toggleTopicCompleted(
                                        course.id,
                                        topic.id
                                      )
                                    }
                                  >
                                    {topic.completed && (
                                      <Check
                                        size={13}
                                      />
                                    )}
                                  </button>

                                  <span>
                                    {topic.name}
                                  </span>
                                </motion.div>
                              )
                            )}
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  /* =======================================================
     GOALS
  ======================================================= */

  const goals = daybookData.dailyGoals as unknown as GoalRecord[];

  function resetGoalForm() {
    setGoalForm({
      name: "",
      target: "",
      dailyMinutes: "30",
      startDate: todayISO(),
      durationText: "30 days",
    });
    setEditingGoalId(null);
    setGoalFormError("");
  }

  function openAddGoal() {
    resetGoalForm();
    setShowGoalForm(true);
  }

  function openEditGoal(goal: GoalRecord) {
    let durationText = "";

    if (goal.startDate && goal.endDate) {
      const start = new Date(`${goal.startDate}T00:00:00`);
      const end = new Date(`${goal.endDate}T00:00:00`);
      const difference =
        Math.round(
          (end.getTime() - start.getTime()) /
            (1000 * 60 * 60 * 24)
        ) + 1;

      if (difference > 0) {
        durationText = `${difference} days`;
      }
    }

    setEditingGoalId(goal.id);
    setGoalForm({
      name: goal.name,
      target: goal.target,
      dailyMinutes: String(goal.dailyMinutes),
      startDate: goal.startDate || todayISO(),
      durationText,
    });
    setGoalFormError("");
    setShowGoalForm(true);
  }

  function saveGoal() {
    const name = goalForm.name.trim();
    const target = goalForm.target.trim();
    const dailyMinutes = Number(goalForm.dailyMinutes);
    const startDate = goalForm.startDate || todayISO();
    const endDate = calculateEndDate(startDate, goalForm.durationText);

    if (!name) {
      setGoalFormError("Please enter a goal name.");
      return;
    }

    if (!target) {
      setGoalFormError("Please enter the daily target.");
      return;
    }

    if (!Number.isFinite(dailyMinutes) || dailyMinutes <= 0) {
      setGoalFormError("Daily time must be greater than 0 minutes.");
      return;
    }

    if (!endDate) {
      setGoalFormError(
        'Enter a duration such as "30 days", "6 weeks", or "2 months".'
      );
      return;
    }

    const newGoal: GoalRecord = {
      id: editingGoalId ?? makeId("goal"),
      name,
      target,
      dailyMinutes,
      startDate,
      endDate,
      active: editingGoalId
        ? goals.find((goal) => goal.id === editingGoalId)?.active ?? true
        : true,
    };

    const updatedGoals = editingGoalId
      ? goals.map((goal) =>
          goal.id === editingGoalId ? newGoal : goal
        )
      : [...goals, newGoal];

    updateDaybookData({
      ...daybookData,
      dailyGoals: updatedGoals as unknown as DaybookData["dailyGoals"],
    });

    setShowGoalForm(false);
    resetGoalForm();
  }

  function toggleGoalActive(goalId: string) {
    const updatedGoals = goals.map((goal) =>
      goal.id === goalId
        ? { ...goal, active: !goal.active }
        : goal
    );

    updateDaybookData({
      ...daybookData,
      dailyGoals: updatedGoals as unknown as DaybookData["dailyGoals"],
    });
  }

  function deleteGoal(goalId: string) {
    const goal = goals.find((item) => item.id === goalId);

    if (!goal) return;

    if (!window.confirm(`Delete "${goal.name}"?`)) {
      return;
    }

    updateDaybookData({
      ...daybookData,
      dailyGoals: goals.filter((item) => item.id !== goalId) as unknown as DaybookData["dailyGoals"],
    });
  }

  function formatGoalDate(dateString: string | null) {
    if (!dateString) return "No end date";

    return new Date(`${dateString}T00:00:00`).toLocaleDateString(
      undefined,
      { day: "numeric", month: "short", year: "numeric" }
    );
  }

  function renderGoals() {
    const sortedGoals = [...goals].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return (
      <div className="page-content">
        <div className="page-header">
          <div>
            <p className="page-eyebrow">DAILY TARGETS</p>
            <h1>Goals</h1>
            <p className="page-subtitle">
              Set the daily goals you want Daybook to schedule.
            </p>
          </div>

          <button className="primary-button" onClick={openAddGoal}>
            <Plus size={17} />
            Add Goal
          </button>
        </div>

        {sortedGoals.length === 0 ? (
          <div className="empty-state">
            <Target size={32} />
            <h2>No daily goals</h2>
            <p>
              Add goals such as LeetCode, reading, exercise or another
              recurring activity.
            </p>
            <button className="primary-button" onClick={openAddGoal}>
              <Plus size={17} />
              Add Your First Goal
            </button>
          </div>
        ) : (
          <div className="goal-list">
            {sortedGoals.map((goal) => (
              <motion.div
                key={goal.id}
                className={`goal-card card ${goal.active ? "" : "goal-paused"}`}
                layout
                whileHover={{ y: -2 }}
              >
                <div className="goal-card-header">
                  <div className="goal-title-area">
                    <div className="goal-icon">
                      <Target size={19} />
                    </div>
                    <div>
                      <div className="goal-title-row">
                        <h3>{goal.name}</h3>
                        {!goal.active && (
                          <span className="course-paused-badge">Paused</span>
                        )}
                      </div>
                      <p>{goal.target} · {goal.dailyMinutes} min/day</p>
                    </div>
                  </div>

                  <div className="course-actions">
                    <button
                      className="icon-button"
                      title="Edit goal"
                      onClick={() => openEditGoal(goal)}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button"
                      title={goal.active ? "Pause goal" : "Resume goal"}
                      onClick={() => toggleGoalActive(goal.id)}
                    >
                      {goal.active ? <Pause size={16} /> : <Check size={16} />}
                    </button>
                    <button
                      className="icon-button danger"
                      title="Delete goal"
                      onClick={() => deleteGoal(goal.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="goal-meta-row">
                  <span><Clock3 size={14} /> {goal.dailyMinutes} minutes scheduled daily</span>
                  <span>{formatGoalDate(goal.startDate)} → {formatGoalDate(goal.endDate)}</span>
                </div>

                <div className="goal-schedule-note">
                  <span className="card-label">SCHEDULING</span>
                  <p>
                    {goal.active
                      ? "Daybook will place this after required academic work when free time is available."
                      : "Paused goals are not considered for new scheduling."}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* =======================================================
     EVENTS
  ======================================================= */

  const eventCategories: { value: EventCategory; label: string }[] = [
    { value: "assignment", label: "Assignment" },
    { value: "submission", label: "Submission" },
    { value: "test", label: "Test" },
    { value: "project", label: "Project" },
    { value: "presentation", label: "Presentation" },
    { value: "college", label: "College event" },
    { value: "personal", label: "Personal" },
    { value: "other", label: "Other" },
  ];

  function getEvents(): DaybookEventRecord[] {
    return daybookData.events as unknown as DaybookEventRecord[];
  }

  function resetEventForm() {
    setEventForm({
      title: "", category: "assignment", date: todayISO(),
      time: "", notes: "", reminderDays: [1, 0],
    });
    setEditingEventId(null);
    setEventFormError("");
  }

  function openAddEvent() {
    resetEventForm();
    setShowEventForm(true);
  }

  function openEditEvent(event: DaybookEventRecord) {
    setEditingEventId(event.id);
    setEventForm({
      title: event.title,
      category: event.category,
      date: event.date,
      time: event.time ?? "",
      notes: event.notes ?? "",
      reminderDays: [...(event.reminderDays ?? [])],
    });
    setEventFormError("");
    setShowEventForm(true);
  }

  function saveEvent() {
    const title = eventForm.title.trim();
    if (!title) {
      setEventFormError("Enter an event title.");
      return;
    }
    if (!eventForm.date) {
      setEventFormError("Select a date.");
      return;
    }
    const existing = getEvents();
    const record: DaybookEventRecord = {
      id: editingEventId ?? makeId("event"),
      title,
      category: eventForm.category,
      date: eventForm.date,
      time: eventForm.time || undefined,
      notes: eventForm.notes.trim() || undefined,
      reminderDays: [...eventForm.reminderDays].sort((a, b) => b - a),
      completed: editingEventId
        ? existing.find((item) => item.id === editingEventId)?.completed ?? false
        : false,
    };
    updateDaybookData({
      ...daybookData,
      events: (editingEventId
        ? existing.map((item) => item.id === editingEventId ? record : item)
        : [...existing, record]) as unknown as DaybookData["events"],
    });
    setShowEventForm(false);
    resetEventForm();
  }

  function deleteEvent(eventId: string) {
    const item = getEvents().find((event) => event.id === eventId);
    if (!item || !window.confirm(`Delete "${item.title}"?`)) return;
    updateDaybookData({
      ...daybookData,
      events: (getEvents().filter((event) => event.id !== eventId) as unknown as DaybookData["events"]),
    });
  }

  function toggleEventComplete(eventId: string) {
    updateDaybookData({
      ...daybookData,
      events: getEvents().map((event) =>
        event.id === eventId ? { ...event, completed: !event.completed } : event
      ) as unknown as DaybookData["events"],
    });
  }

  function eventDayDifference(date: string): number {
    const today = new Date(`${todayISO()}T00:00:00`);
    const target = new Date(`${date}T00:00:00`);
    return Math.round((target.getTime() - today.getTime()) / 86400000);
  }

  function renderEvents() {
    const events = [...getEvents()].sort((a, b) =>
      a.completed === b.completed
        ? `${a.date}T${a.time ?? "23:59"}`.localeCompare(`${b.date}T${b.time ?? "23:59"}`)
        : Number(a.completed) - Number(b.completed)
    );
    const reminders = events.filter((event) =>
      !event.completed &&
      (event.reminderDays ?? []).includes(eventDayDifference(event.date))
    );
    return (
      <div className="page-content">
        <div className="page-header">
          <div>
            <p className="page-eyebrow">IMPORTANT</p>
            <h1>Events</h1>
            <p className="page-subtitle">
              Track assignments, submissions, presentations and one-off plans.
            </p>
          </div>
          <button className="primary-button" onClick={openAddEvent}>
            <Plus size={17} /> Add Event
          </button>
        </div>

        {reminders.length > 0 && (
          <motion.div className="event-reminder-panel card" layout>
            <div className="event-reminder-heading"><Bell size={18} />
              <strong>Reminders for today</strong>
            </div>
            {reminders.map((event) => (
              <div key={event.id} className="event-reminder-item">
                <span>{event.title}</span>
                <strong>{eventDayDifference(event.date) === 0
                  ? "Due today"
                  : `Due in ${eventDayDifference(event.date)} days`}</strong>
              </div>
            ))}
            <small>Shown in Daybook while you have this page open. Browser push notifications are not enabled yet.</small>
          </motion.div>
        )}

        {events.length === 0 ? (
          <div className="empty-state">
            <CalendarClock size={32} />
            <h2>No events added</h2>
            <p>Add a date-specific task or event to keep track of it.</p>
            <button className="primary-button" onClick={openAddEvent}>
              <Plus size={17} /> Add Your First Event
            </button>
          </div>
        ) : (
          <div className="course-list">
            {events.map((event) => {
              const remaining = eventDayDifference(event.date);
              return (
                <motion.div
                  key={event.id}
                  className={`event-card card ${event.completed ? "event-completed" : ""}`}
                  layout whileHover={{ y: -2 }}
                >
                  <div className="course-card-header">
                    <div className="course-title-area">
                      <div className="course-icon"><ClipboardList size={19} /></div>
                      <div>
                        <div className="course-title-row">
                          <h3>{event.title}</h3>
                          <span className="course-type-badge academic">
                            {eventCategories.find((item) => item.value === event.category)?.label ?? "Event"}
                          </span>
                          {event.completed && <span className="course-paused-badge">Completed</span>}
                        </div>
                        <p>
                          {formatDate(event.date)}
                          {event.time ? ` • ${event.time}` : " • All day"}
                        </p>
                      </div>
                    </div>
                    <div className="course-actions">
                      <button className="icon-button" title={event.completed ? "Mark incomplete" : "Mark complete"}
                        onClick={() => toggleEventComplete(event.id)}>
                        <Check size={16} />
                      </button>
                      <button className="icon-button" title="Edit event" onClick={() => openEditEvent(event)}>
                        <Pencil size={16} />
                      </button>
                      <button className="icon-button danger" title="Delete event" onClick={() => deleteEvent(event.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="event-details">
                    <span className={`event-countdown ${remaining <= 1 && !event.completed ? "urgent" : ""}`}>
                      {event.completed ? "Done" : remaining < 0 ? `${Math.abs(remaining)} days overdue`
                        : remaining === 0 ? "Today" : remaining === 1 ? "Tomorrow" : `${remaining} days away`}
                    </span>
                    {(event.reminderDays ?? []).length > 0 && (
                      <span><Bell size={14} /> Reminders: {(event.reminderDays ?? [])
                        .map((days) => days === 0 ? "due date" : `${days}d before`).join(", ")}</span>
                    )}
                  </div>
                  {event.notes && <p className="event-notes">{event.notes}</p>}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  /* =======================================================
     SETTINGS
  ======================================================= */

  function renderSettings() {
    return (
      <div className="page-content">
        <div className="page-header">
          <div>
            <p className="page-eyebrow">DAYBOOK</p>

            <h1>Settings</h1>

            <p className="page-subtitle">
              Manage your Daybook preferences and data.
            </p>
          </div>
        </div>

        <div className="settings-card card">
          <div>
            <span className="card-label">DATA</span>

            <h2>Local storage</h2>

            <p>
              Your Daybook data is currently stored locally
              in this browser.
            </p>
          </div>

          <button
            className="secondary-button"
            onClick={() =>
              saveData(daybookData)
            }
          >
            <Save size={16} />
            Save Data
          </button>
        </div>
      </div>
    );
  }


  function renderLiveNavigationBar() {
    const nowMinutes = liveNow.getHours() * 60 + liveNow.getMinutes();
    const current = liveNavigationItems.find((item) => {
      const start = liveMinutesFromTime(item.startTime);
      const end = liveMinutesFromTime(item.endTime);
      return nowMinutes >= start && nowMinutes < end;
    });
    const next = liveNavigationItems.find(
      (item) => liveMinutesFromTime(item.startTime) > nowMinutes
    );

    if (!current && !next) return null;

    const currentEnd = current ? liveMinutesFromTime(current.endTime) : null;
    const currentRemaining = currentEnd === null
      ? Infinity
      : Math.max(0, currentEnd - nowMinutes);

    // During the final 10 minutes of the current class/learning block,
    // switch the banner to the upcoming block so the next hour is visible
    // before the current block finishes. This mirrors the "up next"
    // behavior the user wants from a navigation-style status bar.
    const showNextEarly = Boolean(current && next && currentRemaining <= 10);
    const target = showNextEarly ? next! : current ?? next!;
    const targetStart = liveMinutesFromTime(target.startTime);
    const targetEnd = liveMinutesFromTime(target.endTime);
    const minutesToNext = Math.max(0, targetStart - nowMinutes);
    const remaining = Math.max(0, targetEnd - nowMinutes);
    const isCurrent = Boolean(current) && !showNextEarly;

    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={`${target.id}-${isCurrent ? "now" : "next"}`}
          className={`live-navigation-bar ${target.kind === "class" ? "live-class" : "live-study"}`}
          initial={{ opacity: 0, y: -12, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.985 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <div className="live-navigation-icon">
            <Navigation2 size={18} />
          </div>

          <div className="live-navigation-main">
            <div className="live-navigation-kicker">
              {isCurrent ? "NOW" : "UP NEXT"}
              <span />
              {target.startTime} – {target.endTime}
            </div>
            <strong>{target.title}</strong>
            <span>{target.subtitle}</span>
          </div>

          <div className="live-navigation-meta">
            {target.kind === "class" && target.room && (
              <span className="live-location"><MapPin size={13} /> {target.room}</span>
            )}
            <span className="live-countdown">
              {isCurrent
                ? `${remaining} min left`
                : minutesToNext < 60
                  ? `starts in ${minutesToNext} min`
                  : `starts in ${Math.floor(minutesToNext / 60)}h ${minutesToNext % 60}m`}
            </span>
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  /* =======================================================
     PAGE ROUTER
  ======================================================= */

  function renderPage() {
    switch (activePage) {
      case "Today":
        return renderToday();

      case "Timetable":
        return renderTimetable();

      case "Exams":
        return renderExams();

      case "Courses":
        return renderCourses();

      case "Goals":
        return renderGoals();

      case "Events":
        return renderEvents();

      case "Settings":
        return renderSettings();

      default:
        return renderToday();
    }
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            D
          </div>

          <div>
            <h1>Daybook</h1>

            <span>
              Plan your day
            </span>
          </div>
        </div>

        <Navigation
          activePage={activePage}
          onPageChange={setActivePage}
        />

        <div className="sidebar-bottom">
          <div className="focus-card">
            <CalendarDays size={17} />

            <div>
              <strong>
                Stay organized
              </strong>

              <span>
                Let Daybook handle the planning.
              </span>
            </div>
          </div>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div>
            <p className="eyebrow">
              DAYBOOK
            </p>

            <h2>{activePage}</h2>
          </div>

          <button
            className="notification-button"
            aria-label="Enable Daybook schedule notifications"
            title="Enable schedule notifications"
            onClick={requestScheduleNotifications}
          >
            <span>🔔</span>
          </button>
        </header>

        {renderLiveNavigationBar()}

        <main className="main">
          <AnimatePresence mode="wait">
            <motion.div
              key={activePage}
              initial={{
                opacity: 0,
                x: 18,
              }}
              animate={{
                opacity: 1,
                x: 0,
              }}
              exit={{
                opacity: 0,
                x: -18,
              }}
              transition={{
                duration: 0.22,
                ease: "easeOut",
              }}
            >
              {renderPage()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* ===================================================
          TIMETABLE IMPORT MODAL
      =================================================== */}
      <AnimatePresence>
        {showTimetableImporter && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setShowTimetableImporter(false);
            }}
          >
            <motion.div
              className="modal-card"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
            >
              <div className="modal-header">
                <div>
                  <span className="card-label">TIMETABLE IMPORT</span>
                  <h2>Upload College Timetable</h2>
                  <p>
                    Daybook extracts only subject, time, room and day. You review it before the active timetable is replaced.
                  </p>
                </div>
                <button className="icon-button" onClick={() => setShowTimetableImporter(false)} aria-label="Close">
                  <X size={18} />
                </button>
              </div>

              <label className="timetable-upload-box">
                <Upload size={28} />
                <strong>{timetableLoading ? "Reading timetable..." : "Choose timetable photo"}</strong>
                <span>PNG, JPG or JPEG • Use a clear, straight photo</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg"
                  hidden
                  disabled={timetableLoading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) processTimetableImage(file);
                  }}
                />
              </label>

              <div className="form-grid">
                <div className="form-field">
                  <label>Valid from</label>
                  <input type="date" value={timetableValidFrom}
                    onChange={(event) => setTimetableValidFrom(event.target.value)} />
                </div>
                <div className="form-field">
                  <label>Valid until (optional)</label>
                  <input type="date" value={timetableValidUntil}
                    onChange={(event) => setTimetableValidUntil(event.target.value)} />
                </div>
              </div>

              {timetableError && <div className="error-message">{timetableError}</div>}

              <div className="modal-actions">
                <button className="secondary-button" onClick={() => setShowTimetableImporter(false)}>
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================================================
          TIMETABLE REVIEW MODAL
      =================================================== */}
      <AnimatePresence>
        {showTimetableReview && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-card timetable-review-modal"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
            >
              <div className="modal-header">
                <div>
                  <span className="card-label">REVIEW</span>
                  <h2>Review Timetable</h2>
                  <p>
                    OCR can make mistakes. Correct anything here before this becomes your active weekly timetable.
                  </p>
                </div>
                <button className="icon-button" onClick={() => setShowTimetableReview(false)} aria-label="Close">
                  <X size={18} />
                </button>
              </div>

              <div className="timetable-review-summary">
                <strong>{timetableReview.length}</strong>
                <span>class entries detected</span>
              </div>

              <div className="timetable-review-list">
                {timetableReview.map((entry, index) => (
                  <motion.div className="timetable-review-row" key={entry.id} layout>
                    <span className="timetable-review-number">{index + 1}</span>

                    <select
                      value={entry.day}
                      onChange={(event) =>
                        updateTimetableReview(entry.id, "day", Number(event.target.value))
                      }
                    >
                      {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                        <option key={day} value={day}>{timetableDayName(day)}</option>
                      ))}
                    </select>

                    <input
                      value={entry.subject}
                      placeholder="Subject"
                      onChange={(event) => updateTimetableReview(entry.id, "subject", event.target.value)}
                    />

                    <input
                      type="time"
                      value={entry.startTime}
                      onChange={(event) => updateTimetableReview(entry.id, "startTime", event.target.value)}
                    />

                    <input
                      type="time"
                      value={entry.endTime}
                      onChange={(event) => updateTimetableReview(entry.id, "endTime", event.target.value)}
                    />

                    <input
                      value={entry.room}
                      placeholder="Room"
                      onChange={(event) => updateTimetableReview(entry.id, "room", event.target.value)}
                    />

                    <button className="icon-button danger" onClick={() => removeTimetableReviewEntry(entry.id)} aria-label="Remove class">
                      <Trash2 size={16} />
                    </button>
                  </motion.div>
                ))}
              </div>

              <button className="secondary-button timetable-add-row" onClick={addTimetableReviewEntry}>
                <Plus size={16} /> Add class manually
              </button>

              {timetableError && <div className="error-message">{timetableError}</div>}

              <div className="modal-actions">
                <button className="secondary-button" onClick={() => setShowTimetableReview(false)}>
                  Cancel
                </button>
                <button className="primary-button" onClick={confirmTimetable}>
                  <Save size={16} /> Save as Active Timetable
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================================================
          EXAM FORM MODAL
      =================================================== */}

      <AnimatePresence>
        {showExamForm && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setShowExamForm(false);
              }
            }}
          >
            <motion.div
              className="modal-card"
              initial={{
                opacity: 0,
                y: 18,
                scale: 0.98,
              }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
              }}
              exit={{
                opacity: 0,
                y: 10,
                scale: 0.98,
              }}
              transition={{ duration: 0.2 }}
            >
              <div className="modal-header">
                <div>
                  <span className="card-label">
                    EXAM
                  </span>

                  <h2>
                    {editingExamId
                      ? "Edit Exam"
                      : "Add Exam"}
                  </h2>

                  <p>
                    Add the exam deadline and topics that
                    need preparation.
                  </p>
                </div>

                <button
                  className="icon-button"
                  onClick={() =>
                    setShowExamForm(false)
                  }
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="form-grid">
                <div className="form-field full">
                  <label>Exam name</label>

                  <input
                    value={examForm.name}
                    onChange={(event) =>
                      setExamForm({
                        ...examForm,
                        name: event.target.value,
                      })
                    }
                    placeholder="e.g. Data Structures Midterm"
                  />
                </div>

                <div className="form-field">
                  <label>Exam date</label>

                  <input
                    type="date"
                    value={examForm.date}
                    onChange={(event) =>
                      setExamForm({
                        ...examForm,
                        date: event.target.value,
                      })
                    }
                  />
                </div>

                <div className="form-field">
                  <label>Difficulty</label>

                  <select
                    value={examForm.difficulty}
                    onChange={(event) =>
                      setExamForm({
                        ...examForm,
                        difficulty:
                          event.target.value as
                            | "easy"
                            | "medium"
                            | "hard",
                      })
                    }
                  >
                    <option value="easy">
                      Easy
                    </option>

                    <option value="medium">
                      Medium
                    </option>

                    <option value="hard">
                      Hard
                    </option>
                  </select>
                </div>

                <div className="form-field full">
                  <label>Linked course</label>

                  <select
                    value={examForm.courseId}
                    onChange={(event) =>
                      setExamForm({
                        ...examForm,
                        courseId: event.target.value,
                      })
                    }
                  >
                    <option value="">
                      No linked course
                    </option>

                    {courses.map((course) => (
                      <option
                        key={course.id}
                        value={course.id}
                      >
                        {course.name}
                      </option>
                    ))}
                  </select>

                  <small>
                    Optional. Link this exam to one of
                    your Daybook courses.
                  </small>
                </div>

                <div className="form-field full">
                  <label>Exam topics</label>

                  <textarea
                    value={examForm.topicsText}
                    onChange={(event) =>
                      setExamForm({
                        ...examForm,
                        topicsText:
                          event.target.value,
                      })
                    }
                    placeholder={
                      "Arrays\nLinked Lists\nStacks\nQueues"
                    }
                    rows={7}
                  />

                  <small>
                    One topic per line. Leave this empty
                    if you only want the exam deadline
                    recorded.
                  </small>
                </div>
              </div>

              {examFormError && (
                <div className="error-message">
                  {examFormError}
                </div>
              )}

              <div className="modal-actions">
                <button
                  className="secondary-button"
                  onClick={() =>
                    setShowExamForm(false)
                  }
                >
                  Cancel
                </button>

                <button
                  className="primary-button"
                  onClick={saveExam}
                >
                  <Save size={16} />

                  {editingExamId
                    ? "Save Changes"
                    : "Create Exam"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================================================
          EVENT FORM MODAL
      =================================================== */}
      <AnimatePresence>
        {showEventForm && (
          <motion.div className="modal-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setShowEventForm(false);
            }}
          >
            <motion.div className="modal-card"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.2 }}
            >
              <div className="modal-header">
                <div>
                  <span className="card-label">ONE-OFF EVENT</span>
                  <h2>{editingEventId ? "Edit Event" : "Add Event"}</h2>
                  <p>Set the date, optional time and reminder days.</p>
                </div>
                <button className="icon-button" onClick={() => setShowEventForm(false)}
                  aria-label="Close"><X size={18} /></button>
              </div>
              <div className="form-grid">
                <div className="form-field full">
                  <label>Title</label>
                  <input value={eventForm.title}
                    onChange={(event) => setEventForm({ ...eventForm, title: event.target.value })}
                    placeholder="e.g. Submit DAA assignment" />
                </div>
                <div className="form-field full">
                  <label>Category</label>
                  <select value={eventForm.category}
                    onChange={(event) => setEventForm({
                      ...eventForm, category: event.target.value as EventCategory
                    })}>
                    {eventCategories.map((category) =>
                      <option key={category.value} value={category.value}>{category.label}</option>)}
                  </select>
                </div>
                <div className="form-field">
                  <label>Date</label>
                  <input type="date" value={eventForm.date}
                    onChange={(event) => setEventForm({ ...eventForm, date: event.target.value })} />
                </div>
                <div className="form-field">
                  <label>Time (optional)</label>
                  <input type="time" value={eventForm.time}
                    onChange={(event) => setEventForm({ ...eventForm, time: event.target.value })} />
                  <small>Leave blank for an all-day event.</small>
                </div>
                <div className="form-field full">
                  <label>Remind me</label>
                  <div className="event-reminder-options">
                    {[7, 4, 2, 1, 0].map((days) => (
                      <label key={days} className="event-reminder-option">
                        <input type="checkbox" checked={eventForm.reminderDays.includes(days)}
                          onChange={(event) => setEventForm({
                            ...eventForm,
                            reminderDays: event.target.checked
                              ? [...eventForm.reminderDays, days]
                              : eventForm.reminderDays.filter((item) => item !== days),
                          })} />
                        {days === 0 ? "Due date" : `${days} days before`}
                      </label>
                    ))}
                  </div>
                  <small>Reminders appear in Daybook on the selected dates.</small>
                </div>
                <div className="form-field full">
                  <label>Notes (optional)</label>
                  <textarea rows={4} value={eventForm.notes}
                    onChange={(event) => setEventForm({ ...eventForm, notes: event.target.value })}
                    placeholder="Any details you want to remember..." />
                </div>
              </div>
              {eventFormError && <div className="error-message">{eventFormError}</div>}
              <div className="modal-actions">
                <button className="secondary-button" onClick={() => setShowEventForm(false)}>Cancel</button>
                <button className="primary-button" onClick={saveEvent}>
                  <Save size={16} /> {editingEventId ? "Save Changes" : "Create Event"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================================================
          GOAL FORM MODAL
      =================================================== */}

      <AnimatePresence>
        {showGoalForm && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setShowGoalForm(false);
              }
            }}
          >
            <motion.div
              className="modal-card"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.2 }}
            >
              <div className="modal-header">
                <div>
                  <span className="card-label">DAILY GOAL</span>
                  <h2>{editingGoalId ? "Edit Goal" : "Add Goal"}</h2>
                  <p>
                    Tell Daybook what you want to do every day and how much time it needs.
                  </p>
                </div>
                <button
                  className="icon-button"
                  onClick={() => setShowGoalForm(false)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="form-grid">
                <div className="form-field full">
                  <label>Goal name</label>
                  <input
                    value={goalForm.name}
                    onChange={(event) =>
                      setGoalForm({ ...goalForm, name: event.target.value })
                    }
                    placeholder="e.g. LeetCode Practice"
                  />
                </div>

                <div className="form-field full">
                  <label>Daily target</label>
                  <input
                    value={goalForm.target}
                    onChange={(event) =>
                      setGoalForm({ ...goalForm, target: event.target.value })
                    }
                    placeholder="e.g. 1 problem, 20 pages, 30 minutes"
                  />
                  <small>This is the outcome you want to achieve each day.</small>
                </div>

                <div className="form-field">
                  <label>Daily time</label>
                  <input
                    type="number"
                    min="1"
                    value={goalForm.dailyMinutes}
                    onChange={(event) =>
                      setGoalForm({ ...goalForm, dailyMinutes: event.target.value })
                    }
                  />
                  <small>Minutes per day</small>
                </div>

                <div className="form-field">
                  <label>Start date</label>
                  <input
                    type="date"
                    value={goalForm.startDate}
                    onChange={(event) =>
                      setGoalForm({ ...goalForm, startDate: event.target.value })
                    }
                  />
                </div>

                <div className="form-field full">
                  <label>Duration</label>
                  <input
                    value={goalForm.durationText}
                    onChange={(event) =>
                      setGoalForm({ ...goalForm, durationText: event.target.value })
                    }
                    placeholder="e.g. 30 days, 6 weeks, 2 months"
                  />
                  <small>Daybook calculates the end date automatically.</small>
                </div>
              </div>

              {goalFormError && (
                <div className="error-message">{goalFormError}</div>
              )}

              <div className="modal-actions">
                <button className="secondary-button" onClick={() => setShowGoalForm(false)}>
                  Cancel
                </button>
                <button className="primary-button" onClick={saveGoal}>
                  <Save size={16} />
                  {editingGoalId ? "Save Changes" : "Create Goal"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================================================
          COURSE FORM MODAL
      =================================================== */}

      <AnimatePresence>
        {showCourseForm && (
          <motion.div
            className="modal-overlay"
            initial={{
              opacity: 0,
            }}
            animate={{
              opacity: 1,
            }}
            exit={{
              opacity: 0,
            }}
            onMouseDown={(event) => {
              if (
                event.target === event.currentTarget
              ) {
                setShowCourseForm(false);
              }
            }}
          >
            <motion.div
              className="modal-card"
              initial={{
                opacity: 0,
                y: 18,
                scale: 0.98,
              }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
              }}
              exit={{
                opacity: 0,
                y: 10,
                scale: 0.98,
              }}
              transition={{
                duration: 0.2,
              }}
            >
              <div className="modal-header">
                <div>
                  <span className="card-label">
                    COURSE
                  </span>

                  <h2>
                    {editingCourseId
                      ? "Edit Course"
                      : "Add Course"}
                  </h2>

                  <p>
                    Define the workload Daybook should
                    plan for this course.
                  </p>
                </div>

                <button
                  className="icon-button"
                  onClick={() =>
                    setShowCourseForm(false)
                  }
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="form-grid">
                <div className="form-field full">
                  <label>
                    Course name
                  </label>

                  <input
                    value={courseForm.name}
                    onChange={(event) =>
                      setCourseForm({
                        ...courseForm,
                        name: event.target.value,
                      })
                    }
                    placeholder="e.g. Data Structures"
                  />
                </div>

                <div className="form-field">
                  <label>
                    Type
                  </label>

                  <select
                    value={courseForm.type}
                    onChange={(event) =>
                      setCourseForm({
                        ...courseForm,
                        type:
                          event.target.value as
                            | "academic"
                            | "non-academic",
                      })
                    }
                  >
                    <option value="academic">
                      Academic
                    </option>

                    <option value="non-academic">
                      Non-academic
                    </option>
                  </select>
                </div>

                <div className="form-field">
                  <label>
                    Start date
                  </label>

                  <input
                    type="date"
                    value={courseForm.startDate}
                    onChange={(event) =>
                      setCourseForm({
                        ...courseForm,
                        startDate:
                          event.target.value,
                      })
                    }
                  />
                </div>

                <div className="form-field">
                  <label>
                    Duration
                  </label>

                  <input
                    value={courseForm.durationText}
                    onChange={(event) =>
                      setCourseForm({
                        ...courseForm,
                        durationText:
                          event.target.value,
                      })
                    }
                    placeholder='e.g. "30 days"'
                  />

                  <small>
                    Examples: 30 days, 6 weeks, 2 months
                  </small>
                </div>

                <div className="form-field">
                  <label>
                    Daily study time
                  </label>

                  <input
                    type="number"
                    min="1"
                    value={courseForm.dailyMinutes}
                    onChange={(event) =>
                      setCourseForm({
                        ...courseForm,
                        dailyMinutes:
                          event.target.value,
                      })
                    }
                  />

                  <small>
                    Minutes per day
                  </small>
                </div>

                <div className="form-field">
                  <label>
                    Weekend weight
                  </label>

                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={courseForm.weekendWeight}
                    onChange={(event) =>
                      setCourseForm({
                        ...courseForm,
                        weekendWeight:
                          event.target.value,
                      })
                    }
                  />

                  <small>
                    Controls weekend distribution, not priority.
                  </small>
                </div>

                <div className="form-field full">
                  <label>
                    Topics
                  </label>

                  <textarea
                    value={courseForm.topicsText}
                    onChange={(event) =>
                      setCourseForm({
                        ...courseForm,
                        topicsText:
                          event.target.value,
                      })
                    }
                    placeholder={
                      "Arrays\nLinked Lists\nStacks\nQueues"
                    }
                    rows={6}
                  />

                  <small>
                    You can enter topics manually or use
                    Import Topics after creating the course.
                  </small>
                </div>
              </div>

              {courseFormError && (
                <div className="error-message">
                  {courseFormError}
                </div>
              )}

              <div className="modal-actions">
                <button
                  className="secondary-button"
                  onClick={() =>
                    setShowCourseForm(false)
                  }
                >
                  Cancel
                </button>

                <button
                  className="primary-button"
                  onClick={saveCourse}
                >
                  <Save size={16} />

                  {editingCourseId
                    ? "Save Changes"
                    : "Create Course"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================================================
          AI COURSE PLANNER MODAL
      =================================================== */}

      <AnimatePresence>
        {showAIPlanner && (() => {
          const course = courses.find((item) => item.id === aiPlannerCourseId);
          if (!course) return null;

          return (
            <motion.div
              className="modal-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeAIPlanner();
              }}
            >
              <motion.div
                className="modal-card ai-planner-modal"
                initial={{ opacity: 0, y: 18, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
              >
                <div className="modal-header">
                  <div>
                    <span className="card-label">AI COURSE PLANNER</span>
                    <h2>{course.name}</h2>
                    <p>Tell Daybook how you want this course divided. AI plans the workload; Daybook decides the actual clock times.</p>
                  </div>
                  <button className="icon-button" onClick={closeAIPlanner} aria-label="Close"><X size={18} /></button>
                </div>

                <div className="ai-planner-layout">
                  <div className="ai-chat-panel">
                    <div className="ai-chat-messages">
                      {aiPlannerHistory.length === 0 && (
                        <div className="ai-welcome">
                          <div className="ai-welcome-icon"><Sparkles size={20} /></div>
                          <strong>How should I plan {course.name}?</strong>
                          <p>Examples: “Break large topics into smaller units”, “finish by November 15”, or “keep weekdays under 45 minutes”.</p>
                        </div>
                      )}
                      {aiPlannerHistory.map((message, index) => (
                        <div key={`${message.role}-${index}`} className={`ai-message ${message.role}`}>
                          <span>{message.role === "user" ? "You" : "Daybook AI"}</span>
                          <p>{message.content}</p>
                        </div>
                      ))}
                    </div>

                    <div className="ai-chat-input">
                      <textarea
                        value={aiPlannerMessage}
                        onChange={(event) => setAIPlannerMessage(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            sendAIPlannerMessage();
                          }
                        }}
                        placeholder="Tell Daybook what you want..."
                        rows={3}
                        disabled={aiPlannerLoading}
                      />
                      <button className="primary-button" onClick={sendAIPlannerMessage} disabled={aiPlannerLoading || !aiPlannerMessage.trim()}>
                        {aiPlannerLoading ? "Planning..." : "Send"}
                        <Send size={15} />
                      </button>
                    </div>
                    {aiPlannerError && <div className="error-message">{aiPlannerError}</div>}
                  </div>

                  <div className="ai-plan-panel">
                    <div className="ai-plan-heading">
                      <div>
                        <span className="card-label">PLAN PREVIEW</span>
                        <h3>Structured course work</h3>
                      </div>
                      <MessageCircle size={18} />
                    </div>

                    {!aiPlannerPlan ? (
                      <div className="ai-plan-empty">
                        <Sparkles size={24} />
                        <p>Your AI-generated subtopics and day distribution will appear here.</p>
                      </div>
                    ) : (
                      <>
                        <div className="ai-interpretation">{aiPlannerPlan.interpretation}</div>
                        <div className="ai-subtopic-list">
                          {aiPlannerPlan.subtopics.map((subtopic) => (
                            <div className="ai-subtopic-row" key={subtopic.id}>
                              <div>
                                <span>{subtopic.parentTopic}</span>
                                <strong>{subtopic.title}</strong>
                              </div>
                              <b>{subtopic.minutes}m</b>
                            </div>
                          ))}
                        </div>
                        <div className="ai-day-list">
                          {aiPlannerPlan.days.map((day) => (
                            <div className="ai-day-row" key={day.day}>
                              <strong>Day {day.day}</strong>
                              <span>{day.minutes} min · {day.subtopicIds.length} unit{day.subtopicIds.length === 1 ? "" : "s"}</span>
                            </div>
                          ))}
                        </div>
                        <div className="modal-actions">
                          <button className="secondary-button" onClick={() => setAIPlannerPlan(null)}>Clear Plan</button>
                          <button className="primary-button" onClick={applyAIPlanTopics}>
                            <Check size={16} />
                            Add AI Subtopics
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* ===================================================
          AI STUDY ASSISTANT MODAL
      =================================================== */}
      <AnimatePresence>
        {showAIStudy && (() => {
          const course = courses.find((item) => item.id === aiStudyCourseId);
          if (!course) return null;
          const practice = aiStudyResponse?.practice;
          return (
            <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) closeAIStudy(); }}>
              <motion.div className="modal-card ai-study-modal" initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }}>
                <div className="modal-header">
                  <div><span className="card-label">AI STUDY ASSISTANT</span><h2>{course.name}</h2><p>Learn, ask questions, upload material, and practice inside Daybook.</p></div>
                  <button className="icon-button" onClick={closeAIStudy} aria-label="Close"><X size={18} /></button>
                </div>
                <div className="ai-study-tabs">
                  {([["chat","Chat",MessageCircle],["mcq","MCQs",ListChecks],["coding","Coding",Code2],["debug","Debug",Bug],["short-answer","Written",FileQuestion]] as const).map(([mode,label,Icon]) => (
                    <button key={mode} className={aiStudyMode === mode ? "active" : ""} onClick={() => { setAIStudyMode(mode); setAIStudyResponse(null); setAIPracticeSubmitted(false); }}><Icon size={15}/>{label}</button>
                  ))}
                </div>
                <div className="ai-study-layout">
                  <div className="ai-study-chat-panel">
                    <div className="ai-chat-messages">
                      {aiStudyHistory.length === 0 && <div className="ai-welcome"><div className="ai-welcome-icon"><Brain size={20}/></div><strong>Study {course.name} here</strong><p>Ask for an explanation, upload notes, or choose a practice mode. The AI uses this course's topics and plan as context.</p></div>}
                      {aiStudyHistory.map((message,index)=><div key={`${message.role}-${index}`} className={`ai-message ${message.role}`}><span>{message.role === "user" ? "You" : "Daybook AI"}</span><p>{message.content}</p></div>)}
                    </div>
                    {aiStudyAttachment && <div className="ai-attachment-chip"><FileText size={15}/><span>{aiStudyAttachment.name}</span><button onClick={() => setAIStudyAttachment(null)}><X size={13}/></button></div>}
                    <div className="ai-study-input-row">
                      <label className="ai-attach-button" title="Attach PDF, DOCX, TXT or image"><Paperclip size={17}/><input type="file" hidden accept=".pdf,.docx,.txt,image/*" onChange={(event)=>{ const file=event.target.files?.[0]; if(file) prepareStudyAttachment(file); event.currentTarget.value=""; }}/></label>
                      <textarea value={aiStudyMessage} onChange={(event)=>setAIStudyMessage(event.target.value)} onKeyDown={(event)=>{ if(event.key === "Enter" && !event.shiftKey){event.preventDefault(); sendAIStudyMessage();}}} placeholder={aiStudyMode === "chat" ? "Ask anything about this course..." : "Add instructions for this practice..."} rows={3} disabled={aiStudyLoading}/>
                      <button className="primary-button" onClick={()=>sendAIStudyMessage()} disabled={aiStudyLoading}>{aiStudyLoading ? "Working..." : "Send"}<Send size={15}/></button>
                    </div>
                    {aiStudyError && <div className="error-message">{aiStudyError}</div>}
                  </div>
                  <div className="ai-study-practice-panel">
                    {!practice ? <div className="ai-plan-empty"><Brain size={25}/><p>Your explanation or practice question will appear here.</p></div> : <>
                      <div className="practice-header"><span className="card-label">{practice.type.toUpperCase()}</span><strong>{practice.question}</strong></div>
                      {practice.options?.map((option,index)=><button key={option} className={`practice-option ${aiPracticeAnswer === option ? "selected" : ""}`} onClick={()=>setAIPracticeAnswer(option)}>{String.fromCharCode(65+index)}. {option}</button>)}
                      {!practice.options && <textarea className="practice-answer" value={aiPracticeAnswer} onChange={(event)=>setAIPracticeAnswer(event.target.value)} placeholder={practice.type === "coding" ? "Write your code here..." : "Write your answer here..."} rows={12}/>} 
                      {practice.options && <input className="practice-answer" value={aiPracticeAnswer} onChange={(event)=>setAIPracticeAnswer(event.target.value)} placeholder="Select or type your answer"/>}
                      {aiPracticeSubmitted && aiStudyResponse?.feedback && <div className="practice-feedback"><strong>{aiPracticeScore !== null ? `${aiPracticeScore}%` : "Feedback"}</strong><p>{aiStudyResponse.feedback}</p></div>}
                      <div className="modal-actions"><button className="secondary-button" onClick={()=>sendAIStudyMessage(aiStudyMode, `Give me another ${aiStudyMode} question.`)} disabled={aiStudyLoading}>Another</button><button className="primary-button" onClick={submitAIPractice} disabled={aiStudyLoading || !aiPracticeAnswer.trim() || aiPracticeSubmitted}>Submit Answer <Check size={15}/></button></div>
                    </>}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* ===================================================
          TOPIC IMPORT MODAL
      =================================================== */}

      <AnimatePresence>
        {showTopicImporter && (
          <motion.div
            className="modal-overlay"
            initial={{
              opacity: 0,
            }}
            animate={{
              opacity: 1,
            }}
            exit={{
              opacity: 0,
            }}
            onMouseDown={(event) => {
              if (
                event.target === event.currentTarget
              ) {
                closeTopicImporter();
              }
            }}
          >
            <motion.div
              className="modal-card"
              initial={{
                opacity: 0,
                y: 18,
                scale: 0.98,
              }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
              }}
              exit={{
                opacity: 0,
                y: 10,
                scale: 0.98,
              }}
            >
              <div className="modal-header">
                <div>
                  <span className="card-label">
                    TOPIC IMPORT
                  </span>

                  <h2>
                    Import Topics
                  </h2>

                  <p>
                    Daybook extracts the topics first.
                    You review them before anything is
                    added to the course.
                  </p>
                </div>

                <button
                  className="icon-button"
                  onClick={closeTopicImporter}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="import-options">
                <button
                  className={`import-option ${
                    topicImportSource === "paste"
                      ? "active"
                      : ""
                  }`}
                  onClick={() =>
                    setTopicImportSource("paste")
                  }
                >
                  <FileText size={19} />

                  <span>
                    <strong>
                      Paste text
                    </strong>

                    <small>
                      Paste your syllabus
                    </small>
                  </span>
                </button>

                <label
                  className={`import-option ${
                    topicImportSource === "txt"
                      ? "active"
                      : ""
                  }`}
                >
                  <FileText size={19} />

                  <span>
                    <strong>
                      TXT
                    </strong>

                    <small>
                      Upload text file
                    </small>
                  </span>

                  <input
                    type="file"
                    accept=".txt,text/plain"
                    hidden
                    onChange={(event) => {
                      const file =
                        event.target.files?.[0];

                      if (file) {
                        setTopicImportSource(
                          "txt"
                        );

                        processTopicImport(
                          file
                        );
                      }
                    }}
                  />
                </label>

                <label
                  className={`import-option ${
                    topicImportSource === "pdf"
                      ? "active"
                      : ""
                  }`}
                >
                  <FileText size={19} />

                  <span>
                    <strong>
                      PDF
                    </strong>

                    <small>
                      Upload syllabus PDF
                    </small>
                  </span>

                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    hidden
                    onChange={(event) => {
                      const file =
                        event.target.files?.[0];

                      if (file) {
                        setTopicImportSource(
                          "pdf"
                        );

                        processTopicImport(
                          file
                        );
                      }
                    }}
                  />
                </label>

                <label
                  className={`import-option ${
                    topicImportSource === "docx"
                      ? "active"
                      : ""
                  }`}
                >
                  <FileText size={19} />

                  <span>
                    <strong>
                      DOCX
                    </strong>

                    <small>
                      Upload Word file
                    </small>
                  </span>

                  <input
                    type="file"
                    accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    hidden
                    onChange={(event) => {
                      const file =
                        event.target.files?.[0];

                      if (file) {
                        setTopicImportSource(
                          "docx"
                        );

                        processTopicImport(
                          file
                        );
                      }
                    }}
                  />
                </label>

                <label
                  className={`import-option ${
                    topicImportSource === "image"
                      ? "active"
                      : ""
                  }`}
                >
                  <ImageIcon size={19} />

                  <span>
                    <strong>
                      Image
                    </strong>

                    <small>
                      OCR a screenshot/photo
                    </small>
                  </span>

                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(event) => {
                      const file =
                        event.target.files?.[0];

                      if (file) {
                        setTopicImportSource(
                          "image"
                        );

                        processTopicImport(
                          file
                        );
                      }
                    }}
                  />
                </label>
              </div>

              {topicImportSource === "paste" && (
                <>
                  <div className="import-divider">
                    <span>
                      Paste syllabus text
                    </span>
                  </div>

                  <textarea
                    className="import-textarea"
                    value={topicImportText}
                    onChange={(event) =>
                      setTopicImportText(
                        event.target.value
                      )
                    }
                    placeholder={
                      "UNIT I: INTRODUCTION\n\n1. Introduction to Data Structures\n2. Arrays\n3. Linked Lists\n4. Stacks and Queues\n\nUNIT II: TREES\n\n5. Binary Trees\n6. Binary Search Trees"
                    }
                    rows={12}
                  />

                  <div className="modal-actions">
                    <button
                      className="secondary-button"
                      onClick={closeTopicImporter}
                      disabled={
                        topicImportLoading
                      }
                    >
                      Cancel
                    </button>

                    <button
                      className="primary-button"
                      onClick={
                        processPastedTopics
                      }
                      disabled={
                        topicImportLoading ||
                        !topicImportText.trim()
                      }
                    >
                      {topicImportLoading ? (
                        "Extracting..."
                      ) : (
                        <>
                          <Upload size={16} />
                          Extract Topics
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}

              {topicImportError && (
                <div className="error-message">
                  {topicImportError}
                </div>
              )}

              {topicImportLoading && (
                <div className="import-loading">
                  <div className="loading-spinner" />

                  <p>
                    Extracting topics. Please wait...
                  </p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================================================
          TOPIC REVIEW MODAL
      =================================================== */}

      <AnimatePresence>
        {showTopicReview && (
          <motion.div
            className="modal-overlay"
            initial={{
              opacity: 0,
            }}
            animate={{
              opacity: 1,
            }}
            exit={{
              opacity: 0,
            }}
          >
            <motion.div
              className="modal-card review-modal"
              initial={{
                opacity: 0,
                y: 18,
                scale: 0.98,
              }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
              }}
              exit={{
                opacity: 0,
                y: 10,
                scale: 0.98,
              }}
            >
              <div className="modal-header">
                <div>
                  <span className="card-label">
                    REVIEW
                  </span>

                  <h2>
                    Review Topics
                  </h2>

                  <p>
                    Check and edit the extracted topics
                    before adding them to the course.
                  </p>
                </div>

                <button
                  className="icon-button"
                  onClick={() =>
                    setShowTopicReview(false)
                  }
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="topic-review-summary">
                <strong>
                  {reviewTopics.length}
                </strong>

                <span>
                  topics detected
                </span>
              </div>

              <div className="review-topic-list">
                {reviewTopics.length === 0 ? (
                  <div className="empty-state small">
                    <p>
                      No topics remain.
                    </p>
                  </div>
                ) : (
                  reviewTopics.map(
                    (topic, index) => (
                      <motion.div
                        key={`${index}-${topic}`}
                        className="review-topic-row"
                        layout
                      >
                        <span className="topic-number">
                          {index + 1}
                        </span>

                        <input
                          value={topic}
                          onChange={(event) =>
                            updateReviewTopic(
                              index,
                              event.target.value
                            )
                          }
                        />

                        <button
                          className="delete-topic-button"
                          onClick={() =>
                            removeReviewTopic(
                              index
                            )
                          }
                          aria-label="Remove topic"
                        >
                          <Trash2 size={15} />
                        </button>
                      </motion.div>
                    )
                  )
                )}
              </div>

              <div className="review-add-row">
                <input
                  value={reviewNewTopic}
                  onChange={(event) =>
                    setReviewNewTopic(
                      event.target.value
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addReviewTopic();
                    }
                  }}
                  placeholder="Add another topic..."
                />

                <button
                  className="secondary-button"
                  onClick={addReviewTopic}
                >
                  <Plus size={16} />
                  Add
                </button>
              </div>

              <div className="modal-actions">
                <button
                  className="secondary-button"
                  onClick={() =>
                    setShowTopicReview(false)
                  }
                >
                  Cancel
                </button>

                <button
                  className="primary-button"
                  onClick={
                    confirmImportedTopics
                  }
                  disabled={
                    reviewTopics.length === 0
                  }
                >
                  <Check size={16} />
                  Add Topics to Course
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;