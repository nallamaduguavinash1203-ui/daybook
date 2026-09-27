// ---------- TIMETABLE ----------

export interface TimetableEntry {
  id: string;
  day: number; // 0 = Sunday, 1 = Monday ... 6 = Saturday
  subject: string;
  room: string;
  startTime: string;
  endTime: string;
}

export interface Timetable {
  id: string;
  validFrom: string;
  validUntil: string;
  entries: TimetableEntry[];
}


// ---------- COURSES ----------

export type CourseType = "academic" | "non-academic";

export interface CourseTopic {
  id: string;
  name: string;
  completed: boolean;
}

export interface Course {
  id: string;
  name: string;
  type: CourseType;
  topics: CourseTopic[];

  startDate: string;
  endDate: string | null;

  dailyMinutes: number;
  weekendWeight: number;

  active: boolean;
}

// ---------- DAILY GOALS ----------

export interface DailyGoal {
  id: string;
  name: string;
  target: string;
  durationMinutes: number;
  active: boolean;
}


// ---------- EVENTS ----------

export interface Event {
  id: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  description: string;
}


// ---------- REMINDERS ----------

export interface Reminder {
  id: string;
  title: string;
  date: string;
  reminderDates: string[];
}


// ---------- CARRY ITEMS ----------

export interface CarryItem {
  id: string;
  name: string;
  date: string;
  completed: boolean;
}


// ---------- WORK STATUS ----------

export type WorkStatus =
  | "scheduled"
  | "in-progress"
  | "completed"
  | "partially-done"
  | "rescheduled"
  | "future";


// ---------- WORK SOURCE ----------

export type WorkSource =
  | "academic"
  | "course"
  | "daily-goal"
  | "pending"
  | "event";


// ---------- SCHEDULED WORK ----------

export interface ScheduledWork {
  id: string;

  title: string;
  source: WorkSource;

  date: string;

  startTime: string;
  endTime: string;

  durationMinutes: number;

  status: WorkStatus;

  courseId?: string;
  topicId?: string;

  remainingMinutes?: number;

  notes?: string;
}
export interface Exam {
  id: string;
  name: string;
  date: string;
  difficulty?: "easy" | "medium" | "hard";
  courseId?: string;
  topics: string[];
}