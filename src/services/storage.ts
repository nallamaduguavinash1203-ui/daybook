import type {
  Timetable,
  Course,
  DailyGoal,
  Event,
  Reminder,
  CarryItem,
  ScheduledWork,
  Exam,
} from "../types";


export interface DaybookData {
  timetable: Timetable | null;
  courses: Course[];
  dailyGoals: DailyGoal[];
  events: Event[];
  reminders: Reminder[];
  carryItems: CarryItem[];
  scheduledWork: ScheduledWork[];
  exams: Exam[];
}

const STORAGE_KEY = "daybook-data-v1";

function createDefaultData(): DaybookData {
  return {
    timetable: null,
    courses: [],
    dailyGoals: [],
    events: [],
    reminders: [],
    carryItems: [],
    scheduledWork: [],
    exams: [],
  };
}
export function loadData(): DaybookData {
  try {
    const savedData = localStorage.getItem(STORAGE_KEY);

    if (!savedData) {
      return createDefaultData();
    }

    const parsedData = JSON.parse(savedData);

    return {
      ...createDefaultData(),
      ...parsedData,
    };
  } catch (error) {
    console.error("Failed to load Daybook data:", error);
    return createDefaultData();
  }
}

export function saveData(data: DaybookData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error("Failed to save Daybook data:", error);
  }
}

export function updateData(
  updater: (data: DaybookData) => DaybookData
): DaybookData {
  const currentData = loadData();
  const updatedData = updater(currentData);

  saveData(updatedData);

  return updatedData;
}

export function clearData(): void {
  localStorage.removeItem(STORAGE_KEY);
}
