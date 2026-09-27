import {
  CalendarDays,
  ClipboardList,
  GraduationCap,
  Target,
  CalendarClock,
  Settings,
  LayoutDashboard,
} from "lucide-react";

interface NavigationProps {
  activePage: string;
  onPageChange: (page: string) => void;
}

const pages = [
  { name: "Today", icon: LayoutDashboard },
  { name: "Timetable", icon: CalendarDays },
  { name: "Exams", icon: ClipboardList },
  { name: "Courses", icon: GraduationCap },
  { name: "Goals", icon: Target },
  { name: "Events", icon: CalendarClock },
  { name: "Settings", icon: Settings },
];

function Navigation({ activePage, onPageChange }: NavigationProps) {
  return (
    <nav className="navigation">
      {pages.map(({ name, icon: Icon }) => (
        <button
          key={name}
          className={`nav-button ${
            activePage === name ? "active" : ""
          }`}
          onClick={() => onPageChange(name)}
        >
          <Icon size={19} strokeWidth={1.9} />
          <span>{name}</span>
        </button>
      ))}
    </nav>
  );
}

export default Navigation;
