import React, { useState } from "react";
import {
  CalendarIcon,
  BookOpenIcon,
  ZoomInIcon,
  ChevronLeftIcon,
  ChevronRightIcon
} from "lucide-react";

const LeftSidebar = ({ setCurrentPage, currentPage }) => {
  const [collapsed, setCollapsed] = useState(false);

  const toggleSidebar = () => setCollapsed(!collapsed);

  const menuItems = [
    { id: "planner", icon: <CalendarIcon size={20} />, label: "4-Year Planner" },
    { id: "storage", icon: <BookOpenIcon size={20} />, label: "Course Storage" },
    { id: "quarter", icon: <ZoomInIcon size={20} />, label: "Quarter View" },
  ];

  return (
    <div
      className={`flex flex-col bg-white border-r shadow-sm h-full transition-all duration-300 ${
        collapsed ? "w-16" : "w-48"
      }`}
    >
      <div className="flex items-center justify-between p-2 border-b">
        {!collapsed && <span className="font-semibold text-gray-700">Navigate</span>}
        <button
          onClick={toggleSidebar}
          className="p-1 hover:bg-gray-200 rounded transition"
        >
          {collapsed ? <ChevronRightIcon size={20} /> : <ChevronLeftIcon size={20} />}
        </button>
      </div>

      <div className="flex-1">
        {menuItems.map((item) => {
          const isActive = currentPage === item.id;

          return (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id)}
              className={`flex items-center w-full px-3 py-2 transition font-medium rounded-r-md
                ${isActive ? "bg-blue-100 text-blue-700 font-semibold" : "text-gray-700"}
                hover:bg-gray-100`}
            >
              {item.icon}
              {!collapsed && <span className="ml-3">{item.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default LeftSidebar;
