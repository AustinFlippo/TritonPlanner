const Header = () => {
  return (
    <header className="flex items-center px-4 flex-shrink-0" style={{ height: '44px', background: '#003366' }}>
      <svg width="22" height="28" viewBox="0 0 22 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polygon points="11,0 8.5,5.5 13.5,5.5" fill="white"/>
        <polygon points="2.5,3.5 0,9 5,9" fill="#7db8e8" opacity="0.85"/>
        <polygon points="19.5,3.5 17,9 22,9" fill="#7db8e8" opacity="0.85"/>
        <rect x="9" y="4" width="4" height="21" rx="2" fill="white"/>
        <rect x="0.5" y="7" width="3.5" height="15" rx="1.75" fill="#7db8e8"/>
        <rect x="18" y="7" width="3.5" height="15" rx="1.75" fill="#7db8e8"/>
        <rect x="0.5" y="8.5" width="21" height="2.5" rx="1.25" fill="#7db8e8" opacity="0.6"/>
        <rect x="9" y="25" width="4" height="3" rx="1" fill="#7db8e8" opacity="0.5"/>
      </svg>
      <div className="ml-3">
        <span style={{ color: 'white', fontSize: '17px', fontWeight: 800, letterSpacing: '-0.3px' }}>Triton</span>
        <span style={{ color: 'white', fontSize: '17px', fontWeight: 300, letterSpacing: '-0.3px' }}>Planner</span>
      </div>
    </header>
  );
};

export default Header;
