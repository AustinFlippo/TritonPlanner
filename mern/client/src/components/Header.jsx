import React from "react";

const Header = ({
  currentPage
}) => {
  return (
    <header className="bg-blue-500 text-white p-3 text-xl font-bold">
      {currentPage}
    </header>
  );
};

export default Header;
