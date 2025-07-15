import React from "react";

const Header = ({
  currentPage,
  onTutorialClick
}) => {
  return (
    <header className="bg-blue-500 text-white p-3 text-xl font-bold flex justify-between items-center">
      <div>{currentPage}</div>
      <button
        onClick={onTutorialClick}
        className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors duration-200"
      >
        Tutorial
      </button>
    </header>
  );
};

export default Header;
