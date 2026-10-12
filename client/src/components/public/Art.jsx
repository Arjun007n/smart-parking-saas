// Original illustrations for the public website, drawn in SVG. Nothing here is a photo or a copy of anyone else's artwork.

const PATHS = {
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6l1-8Z',
  shield: 'M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm-1 14-3-3 1.4-1.4L11 13.2l4.6-4.6L17 10l-6 6Z',
  rupee: 'M7 4h10v2h-3.2c.8.7 1.3 1.6 1.5 2.7H17v2h-1.7c-.4 2.3-2.2 3.9-5.1 4L16 20h-2.7L7.6 14.5V13h2.5c1.7 0 2.8-.8 3.1-2H7V9h6.1C12.8 7.5 11.7 6.8 10.1 6.8H7V4Z',
  chart: 'M4 20V10h3v10H4Zm6.5 0V4h3v16h-3Zm6.5 0v-7h3v7h-3Z',
  car: 'M5 11 6.6 6.8A2 2 0 0 1 8.5 5.5h7a2 2 0 0 1 1.9 1.3L19 11h.5A1.5 1.5 0 0 1 21 12.5V17h-2v1.5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1V17H8v1.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V17H3v-4.5A1.5 1.5 0 0 1 4.5 11H5Zm2.1 0h9.8l-1.1-3H8.2l-1.1 3ZM7 14a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm10 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  pin: 'M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z',
  printer: 'M7 3h10v4H7V3Zm-3 5h16a1 1 0 0 1 1 1v7h-4v4H7v-4H3V9a1 1 0 0 1 1-1Zm5 6v4h6v-4H9Zm9-3.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  camera: 'M9 4 7.6 6H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2.6L15 4H9Zm3 4.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  pass: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm-2 7h4c0-1.5-1-2.5-2-2.5S5 14.500 5 16Zm7-6v1.800h6V10h-6Zm0 3.200V15h4.500v-1.800H12Z',
  users: 'M9 11a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7Zm7 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM9 13c-3 0-6 1.500-6 4v3h12v-3c0-2.500-3-4-6-4Zm7.500.2c2.700.2 4.500 1.600 4.500 3.800v3h-4v-3c0-1.500-.200-2.800-.500-3.800Z',
  gate: 'M4 20V4h2v16H4Zm3-9V8h14v3H7Zm2-3h2v3H9V8Zm4 0h2v3h-2V8Zm4 0h2v3h-2V8ZM2 20h6v2H2v-2Z',
  settings: 'm19.400 13 1.700 1.300-1.800 3.100-2-.800a7 7 0 0 1-1.500.900L15.500 20h-3.600l-.300-2.500a7 7 0 0 1-1.500-.900l-2 .800-1.800-3.100L8 13a7.800 7.800 0 0 1 0-2L6.300 9.700l1.800-3.100 2 .8a7 7 0 0 1 1.500-.9L11.900 4h3.600l.300 2.500a7 7 0 0 1 1.500.9l2-.8 1.800 3.100L19.400 11a7.800 7.800 0 0 1 0 2ZM13.700 9.500a2.500 2.500 0 1 0 0 5 2.500 2.500 0 0 0 0-5Z',
  qr: 'M3 3h7v7H3V3Zm2 2v3h3V5H5Zm9-2h7v7h-7V3Zm2 2v3h3V5h-3ZM3 14h7v7H3v-7Zm2 2v3h3v-3H5Zm9-2h3v3h-3v-3Zm4 0h3v3h-3v-3Zm-4 4h3v3h-3v-3Zm4 0h3v3h-3v-3Z',
  check: 'm9.500 16.200-3.700-3.700L4.400 13.900l5.100 5.100L20.600 7.900 19.200 6.500 9.500 16.200Z',
  phone: 'M6.600 10.800a15 15 0 0 0 6.600 6.600l2.200-2.200a1 1 0 0 1 1-.25 11.400 11.400 0 0 0 3.600.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.500a1 1 0 0 1 1 1c0 1.300.200 2.500.570 3.600a1 1 0 0 1-.250 1l-2.200 2.200Z',
  mail: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1.500 2 7.500 5.500L19.500 7h-15Z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5h-2v6l5 3 1-1.700-4-2.300V7Z',
  lock: 'M17 9V7a5 5 0 0 0-10 0v2H5v12h14V9h-2Zm-8 0V7a3 3 0 0 1 6 0v2H9Zm3 5a2 2 0 0 1 1 3.700V19h-2v-1.300A2 2 0 0 1 12 14Z',
  card: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 3v2h16V8H4Zm0 5v4h6v-4H4Z',
  plane: 'M21 16v-2l-8-5V3.500a1.500 1.500 0 0 0-3 0V9l-8 5v2l8-2.500V19l-2 1.500V22l3.500-1 3.500 1v-1.500L13 19v-5.500L21 16Z',
  video: 'M4 5h11a2 2 0 0 1 2 2v3.500l5-3v9l-5-3V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  arrow: 'M13 5l7 7-7 7-1.400-1.400L16.200 13H4v-2h12.200l-4.600-4.600L13 5Z',
}

export function Icon({ name, className = 'h-6 w-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden="true" className={className}>
      <path d={PATHS[name] || PATHS.check} />
    </svg>
  )
}

// A round icon on a soft blue square, used on feature cards.
export function IconBadge({ name, className = '' }) {
  return (
    <span className={`pub-icon ${className}`}>
      <Icon name={name} />
    </span>
  )
}

// The wide hero picture: a city, a road, a car arriving at a boom barrier, and floating screens.
export function HeroScene({ className = '' }) {
  return (
    <svg viewBox="0 0 720 440" role="img" aria-label="A car arriving at a parking gate, with a dashboard, a phone and a ticket printer" className={className}>
      <defs>
        <linearGradient id="hs-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#cfe3ff" />
          <stop offset="1" stopColor="#f4f9ff" />
        </linearGradient>
        <linearGradient id="hs-car" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a7bff" />
          <stop offset="1" stopColor="#0b3f9c" />
        </linearGradient>
        <linearGradient id="hs-road" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a4a63" />
          <stop offset="1" stopColor="#222d3f" />
        </linearGradient>
        <linearGradient id="hs-screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#eef4ff" />
        </linearGradient>
      </defs>

      <rect width="720" height="440" rx="28" fill="url(#hs-sky)" />
      <circle cx="610" cy="78" r="46" fill="#fff" opacity="0.75" />
      <circle cx="610" cy="78" r="30" fill="#ffd89a" opacity="0.8" />

      {/* skyline */}
      <g fill="#b7cff5" opacity="0.8">
        <rect x="20" y="210" width="46" height="130" rx="3" />
        <rect x="74" y="170" width="38" height="170" rx="3" />
        <rect x="120" y="230" width="52" height="110" rx="3" />
        <rect x="470" y="190" width="44" height="150" rx="3" />
        <rect x="522" y="150" width="40" height="190" rx="3" />
        <rect x="570" y="215" width="56" height="125" rx="3" />
        <rect x="634" y="180" width="50" height="160" rx="3" />
      </g>
      <g fill="#e8f1ff" opacity="0.95">
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <rect x="84" y={184 + i * 26} width="8" height="10" rx="1" />
            <rect x="98" y={184 + i * 26} width="8" height="10" rx="1" />
            <rect x="532" y={166 + i * 28} width="8" height="10" rx="1" />
            <rect x="546" y={166 + i * 28} width="8" height="10" rx="1" />
          </g>
        ))}
      </g>

      {/* road */}
      <rect x="0" y="332" width="720" height="108" fill="url(#hs-road)" />
      <rect x="0" y="332" width="720" height="8" fill="#e8eef9" />
      <g fill="#f5f8ff" opacity="0.85">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <rect key={i} x={20 + i * 104} y="392" width="58" height="7" rx="3" />
        ))}
      </g>

      {/* dashboard window */}
      <g className="pub-float-slow">
        <rect x="52" y="44" width="330" height="214" rx="14" fill="#0f2547" />
        <rect x="60" y="52" width="314" height="198" rx="9" fill="url(#hs-screen)" />
        <rect x="60" y="52" width="314" height="22" rx="9" fill="#e4edfb" />
        <circle cx="74" cy="63" r="3.500" fill="#ff6b6b" />
        <circle cx="86" cy="63" r="3.500" fill="#ffc542" />
        <circle cx="98" cy="63" r="3.500" fill="#3ddc84" />
        <rect x="60" y="74" width="62" height="176" fill="#0b2a55" />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x="68" y={86 + i * 26} width="46" height="10" rx="3" fill={i === 0 ? '#fc7800' : '#3c5d92'} />
        ))}
        {[
          ['#1867e1', 'Inside'],
          ['#19b63d', 'Entries'],
          ['#fc7800', 'Revenue'],
        ].map(([color], i) => (
          <g key={color}>
            <rect x={132 + i * 80} y="82" width="72" height="42" rx="7" fill="#fff" stroke="#dbe6f7" />
            <rect x={140 + i * 80} y="92" width="30" height="6" rx="3" fill="#b5c6e3" />
            <rect x={140 + i * 80} y="106" width="44" height="10" rx="3" fill={color} />
          </g>
        ))}
        <rect x="132" y="134" width="232" height="108" rx="8" fill="#fff" stroke="#dbe6f7" />
        {[18, 34, 28, 52, 70, 44, 60, 82, 64, 40].map((h, i) => (
          <rect key={i} x={146 + i * 21} y={232 - h} width="12" height={h} rx="3" fill={i === 7 ? '#fc7800' : '#4f8df0'} />
        ))}
        <path d="M146 214 C 180 190, 200 206, 232 176 S 300 168, 350 150" fill="none" stroke="#0b2a55" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
        <rect x="150" y="258" width="222" height="10" rx="5" fill="#0f2547" />
        <rect x="204" y="268" width="114" height="8" rx="4" fill="#0b1c38" />
      </g>

      {/* barrier gate */}
      <g>
        <rect x="548" y="248" width="40" height="92" rx="8" fill="#0b2a55" />
        <rect x="556" y="258" width="24" height="30" rx="4" fill="#19b63d" />
        <path d="M562 266h12M568 262v18" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity="0.9" />
        <circle cx="568" cy="304" r="6" fill="#fc7800" />
        <g className="pub-barrier-arm">
          <rect x="584" y="262" width="118" height="9" rx="4.500" fill="#fff" />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={592 + i * 28} y="262" width="14" height="9" fill="#ff5a3c" />
          ))}
        </g>
      </g>

      {/* car */}
      <g className="pub-drive">
        <ellipse cx="318" cy="372" rx="118" ry="9" fill="#0b1626" opacity="0.35" />
        <path d="M172 360v-28c0-9 6-16 15-18l30-6 28-34c5-6 12-9 20-9h72c9 0 17 4 22 11l24 32 34 8c10 2 17 11 17 22v22c0 4-3 7-7 7h-12a34 34 0 0 0-68 0H264a34 34 0 0 0-68 0h-17c-4 0-7-3-7-7Z" fill="url(#hs-car)" />
        <path d="M255 288l22-27c3-4 8-6 13-6h66c6 0 12 3 15 8l17 25H255Z" fill="#cfe3ff" opacity="0.92" />
        <path d="M322 255v33" stroke="#0b3f9c" strokeWidth="4" />
        <rect x="190" y="326" width="22" height="9" rx="4" fill="#ffe28a" />
        <rect x="414" y="326" width="22" height="9" rx="4" fill="#ff7b6b" />
        <rect x="288" y="338" width="64" height="18" rx="3" fill="#fff" />
        <text x="320" y="351" textAnchor="middle" fontSize="11" fontWeight="700" fill="#0b2a55" fontFamily="Inter, Arial, sans-serif">MP 04 AB 1234</text>
        {[230, 394].map((x) => (
          <g key={x}>
            <circle cx={x} cy="366" r="30" fill="#141c2b" />
            <circle cx={x} cy="366" r="15" fill="#cdd8ea" />
            <circle cx={x} cy="366" r="5" fill="#6d7f9e" />
          </g>
        ))}
      </g>

      {/* phone */}
      <g transform="translate(458 70)"><g className="pub-float">
        <rect width="92" height="176" rx="16" fill="#0f2547" />
        <rect x="5" y="6" width="82" height="164" rx="12" fill="#fff" />
        <rect x="32" y="9" width="28" height="5" rx="2.500" fill="#0f2547" />
        <rect x="14" y="26" width="64" height="10" rx="5" fill="#e4edfb" />
        <circle cx="46" cy="66" r="17" fill="#e1f8e8" />
        <path d="m37 66 7 7 12-14" fill="none" stroke="#19b63d" strokeWidth="4.500" strokeLinecap="round" strokeLinejoin="round" />
        <text x="46" y="100" textAnchor="middle" fontSize="13" fontWeight="700" fill="#0b2a55" fontFamily="Outfit, Inter, sans-serif">₹120.00</text>
        <text x="46" y="114" textAnchor="middle" fontSize="8" fill="#5a6b87" fontFamily="Inter, sans-serif">Payment received</text>
        <rect x="16" y="128" width="60" height="22" rx="11" fill="#fc7800" />
        <text x="46" y="143" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" fontFamily="Inter, sans-serif">Receipt</text>
      </g></g>

      {/* ticket printer */}
      <g transform="translate(402 262)">
        <rect x="0" y="22" width="76" height="44" rx="9" fill="#10233f" />
        <rect x="8" y="12" width="60" height="16" rx="4" fill="#233a62" />
        <rect x="14" y="0" width="48" height="26" rx="3" fill="#fff" />
        <rect x="20" y="6" width="24" height="3" rx="1.500" fill="#b5c6e3" />
        <rect x="20" y="13" width="34" height="3" rx="1.500" fill="#b5c6e3" />
        <circle cx="60" cy="50" r="4" fill="#19b63d" />
      </g>
    </svg>
  )
}

// A paper ticket the old way: handwritten lines.
export function OldTicket({ className = '' }) {
  return (
    <svg viewBox="0 0 280 330" role="img" aria-label="An old handwritten paper parking ticket" className={className}>
      <defs>
        <filter id="ot-shadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#10233f" floodOpacity="0.2" />
        </filter>
      </defs>
      <path d="M20 14h240v286l-12-10-12 10-12-10-12 10-12-10-12 10-12-10-12 10-12-10-12 10-12-10-12 10-12-10-12 10-12-10-12 10-12-10-12 10-12-10-12 10V14Z" fill="#fffdf7" stroke="#e8dfc8" filter="url(#ot-shadow)" />
      <text x="40" y="52" fontSize="16" fontWeight="700" fill="#233a62" fontFamily="Outfit, Inter, sans-serif">PARKING TICKET</text>
      <text x="196" y="52" fontSize="9" fill="#556" fontFamily="Inter, sans-serif">No. 458732</text>
      {['Date', 'Time in', 'Vehicle no.', 'Amount'].map((label, i) => (
        <g key={label}>
          <text x="40" y={96 + i * 46} fontSize="10" fill="#556" fontFamily="Inter, sans-serif">{label}:</text>
          <path d={`M98 ${98 + i * 46}h150`} stroke="#9fb0cc" strokeWidth="1" strokeDasharray="3 3" />
        </g>
      ))}
      <text x="104" y="94" fontSize="14" fill="#2b4a9a" fontFamily="'Comic Sans MS', cursive" fontStyle="italic">25/05/2026</text>
      <text x="104" y="140" fontSize="14" fill="#2b4a9a" fontFamily="'Comic Sans MS', cursive" fontStyle="italic">10:15 AM</text>
      <text x="104" y="186" fontSize="14" fill="#2b4a9a" fontFamily="'Comic Sans MS', cursive" fontStyle="italic">MP 04 BD 3333</text>
      <text x="104" y="232" fontSize="14" fill="#2b4a9a" fontFamily="'Comic Sans MS', cursive" fontStyle="italic">₹ ?</text>
      <rect x="40" y="252" width="200" height="26" rx="4" fill="#fff1e6" />
      <text x="140" y="270" textAnchor="middle" fontSize="10" fontWeight="700" fill="#c25a00" fontFamily="Inter, sans-serif">Lost? Smudged? Miscounted?</text>
    </svg>
  )
}

// The phone the operator or customer uses: entry screen.
export function PhoneMock({ className = '', screen = 'entry' }) {
  return (
    <svg viewBox="0 0 200 400" role="img" aria-label="A phone showing the parking app" className={className}>
      <rect x="4" y="4" width="192" height="392" rx="30" fill="#0f2547" />
      <rect x="12" y="12" width="176" height="376" rx="24" fill="#fff" />
      <rect x="72" y="18" width="56" height="9" rx="4.500" fill="#0f2547" />
      <rect x="12" y="40" width="176" height="44" fill="#0047ab" />
      <text x="26" y="67" fontSize="14" fontWeight="700" fill="#fff" fontFamily="Outfit, Inter, sans-serif">{screen === 'entry' ? 'New entry' : 'Exit'}</text>
      <circle cx="168" cy="62" r="9" fill="#fc7800" />
      <rect x="26" y="100" width="148" height="12" rx="6" fill="#e4edfb" />
      <rect x="26" y="122" width="148" height="34" rx="9" fill="#f4f8ff" stroke="#c9d9f2" />
      <text x="100" y="145" textAnchor="middle" fontSize="15" fontWeight="700" fill="#0b2a55" fontFamily="Inter, sans-serif">MP 04 AB 1234</text>
      <rect x="26" y="166" width="70" height="30" rx="8" fill="#e6f0ff" />
      <text x="61" y="186" textAnchor="middle" fontSize="11" fontWeight="600" fill="#0047ab" fontFamily="Inter, sans-serif">Car</text>
      <rect x="104" y="166" width="70" height="30" rx="8" fill="#f4f8ff" stroke="#c9d9f2" />
      <text x="139" y="186" textAnchor="middle" fontSize="11" fill="#5a6b87" fontFamily="Inter, sans-serif">Bike</text>
      <rect x="26" y="214" width="148" height="40" rx="10" fill="#19b63d" />
      <text x="100" y="239" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff" fontFamily="Inter, sans-serif">Entry</text>
      <rect x="26" y="272" width="148" height="86" rx="12" fill="#fff" stroke="#dbe6f7" />
      <rect x="36" y="282" width="60" height="7" rx="3.500" fill="#b5c6e3" />
      <rect x="36" y="296" width="90" height="7" rx="3.500" fill="#dbe6f7" />
      <rect x="36" y="310" width="76" height="7" rx="3.500" fill="#dbe6f7" />
      <rect x="132" y="296" width="32" height="32" rx="4" fill="#10233f" />
      <path d="M137 301h9v9h-9zM150 301h9v9h-9zM137 314h9v9h-9zM150 314h4v4h-4zM156 320h4v4h-4z" fill="#fff" />
    </svg>
  )
}

// A browser window with the admin dashboard.
export function DashboardMock({ className = '' }) {
  return (
    <svg viewBox="0 0 640 400" role="img" aria-label="The admin dashboard with occupancy, revenue and a chart" className={className}>
      <rect x="2" y="2" width="636" height="396" rx="16" fill="#fff" stroke="#d3e0f5" strokeWidth="2" />
      <rect x="2" y="2" width="636" height="34" rx="16" fill="#eef4ff" />
      <circle cx="22" cy="19" r="5" fill="#ff6b6b" />
      <circle cx="38" cy="19" r="5" fill="#ffc542" />
      <circle cx="54" cy="19" r="5" fill="#3ddc84" />
      <rect x="2" y="36" width="130" height="362" fill="#0b2a55" />
      {['Dashboard', 'Locations', 'Passes', 'Wallets', 'Reports', 'Hardware'].map((label, i) => (
        <g key={label}>
          <rect x="14" y={52 + i * 36} width="106" height="26" rx="7" fill={i === 0 ? '#1867e1' : 'transparent'} />
          <text x="28" y={69 + i * 36} fontSize="11" fill={i === 0 ? '#fff' : '#9fb6dd'} fontFamily="Inter, sans-serif">{label}</text>
        </g>
      ))}
      {[
        ['Vehicles inside', '184', '#1867e1'],
        ['Entries today', '612', '#19b63d'],
        ['Revenue today', '₹48,250', '#fc7800'],
        ['Free spaces', '66', '#7a3fd2'],
      ].map(([label, value, color], i) => (
        <g key={label}>
          <rect x={148 + i * 122} y="52" width="112" height="64" rx="10" fill="#fff" stroke="#dbe6f7" />
          <rect x={148 + i * 122} y="52" width="5" height="64" rx="2.500" fill={color} />
          <text x={162 + i * 122} y="74" fontSize="9" fill="#5a6b87" fontFamily="Inter, sans-serif">{label}</text>
          <text x={162 + i * 122} y="100" fontSize="17" fontWeight="700" fill="#10233f" fontFamily="Outfit, Inter, sans-serif">{value}</text>
        </g>
      ))}
      <rect x="148" y="132" width="296" height="248" rx="10" fill="#fff" stroke="#dbe6f7" />
      <text x="162" y="154" fontSize="11" fontWeight="600" fill="#10233f" fontFamily="Inter, sans-serif">Entries and exits by hour</text>
      {[30, 52, 44, 80, 112, 96, 140, 120, 88, 64, 100, 76].map((h, i) => (
        <g key={i}>
          <rect x={164 + i * 23} y={360 - h} width="9" height={h} rx="3" fill="#4f8df0" />
          <rect x={174 + i * 23} y={360 - h * 0.7} width="9" height={h * 0.7} rx="3" fill="#fc7800" opacity="0.85" />
        </g>
      ))}
      <rect x="458" y="132" width="172" height="248" rx="10" fill="#fff" stroke="#dbe6f7" />
      <text x="472" y="154" fontSize="11" fontWeight="600" fill="#10233f" fontFamily="Inter, sans-serif">Occupancy</text>
      <circle cx="544" cy="236" r="52" fill="none" stroke="#e4edfb" strokeWidth="16" />
      <circle cx="544" cy="236" r="52" fill="none" stroke="#1867e1" strokeWidth="16" strokeDasharray="234 327" strokeLinecap="round" transform="rotate(-90 544 236)" />
      <text x="544" y="242" textAnchor="middle" fontSize="20" fontWeight="700" fill="#10233f" fontFamily="Outfit, Inter, sans-serif">74%</text>
      {['Car', 'Bike', 'Truck'].map((label, i) => (
        <g key={label}>
          <rect x="472" y={310 + i * 20} width="60" height="6" rx="3" fill="#e4edfb" />
          <rect x="472" y={310 + i * 20} width={[48, 34, 14][i]} height="6" rx="3" fill="#1867e1" />
          <text x="542" y={316 + i * 20} fontSize="9" fill="#5a6b87" fontFamily="Inter, sans-serif">{label}</text>
        </g>
      ))}
    </svg>
  )
}

// Round seal used on the pricing cards.
export function Seal({ top, big, bottom, className = '' }) {
  return (
    <svg viewBox="0 0 120 120" role="img" aria-label={`${big} ${top} ${bottom}`} className={className}>
      <defs>
        <linearGradient id="seal-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd36b" />
          <stop offset="1" stopColor="#f08a00" />
        </linearGradient>
      </defs>
      <path d="M60 4l10 8 13-2 6 12 13 4-1 13 10 9-6 12 3 13-12 6-3 13-13 0-9 10-12-6-12 6-9-10-13 0-3-13-12-6 3-13-6-12 10-9-1-13 13-4 6-12 13 2 10-8Z" fill="url(#seal-g)" />
      <circle cx="60" cy="60" r="40" fill="#0b2a55" />
      <circle cx="60" cy="60" r="36" fill="none" stroke="#ffd36b" strokeWidth="1.500" strokeDasharray="3 3" />
      <text x="60" y="38" textAnchor="middle" fontSize="9" fontWeight="700" fill="#ffd36b" fontFamily="Inter, sans-serif">{top}</text>
      <text x="60" y="68" textAnchor="middle" fontSize="30" fontWeight="800" fill="#fff" fontFamily="Outfit, Inter, sans-serif">{big}</text>
      <text x="60" y="84" textAnchor="middle" fontSize="9" fontWeight="700" fill="#ffd36b" fontFamily="Inter, sans-serif">{bottom}</text>
    </svg>
  )
}

// Hardware illustrations, one per product kind.
export function HardwareArt({ kind, className = '' }) {
  const common = { viewBox: '0 0 160 120', className, role: 'img' }
  if (kind === 'barrier') {
    return (
      <svg {...common} aria-label="Boom barrier">
        <rect x="14" y="52" width="34" height="58" rx="7" fill="#0b2a55" />
        <rect x="21" y="60" width="20" height="22" rx="4" fill="#19b63d" />
        <circle cx="31" cy="94" r="5" fill="#fc7800" />
        <rect x="44" y="60" width="104" height="9" rx="4.500" fill="#fff" stroke="#d3e0f5" />
        {[0, 1, 2, 3].map((i) => <rect key={i} x={54 + i * 24} y="60" width="12" height="9" fill="#ff5a3c" />)}
        <rect x="0" y="110" width="160" height="4" rx="2" fill="#c9d9f2" />
      </svg>
    )
  }
  if (kind === 'camera') {
    return (
      <svg {...common} aria-label="Camera">
        <rect x="24" y="30" width="86" height="42" rx="10" fill="#10233f" />
        <circle cx="96" cy="51" r="15" fill="#233a62" />
        <circle cx="96" cy="51" r="8" fill="#4f8df0" />
        <circle cx="92" cy="47" r="2.500" fill="#fff" opacity="0.8" />
        <rect x="108" y="40" width="26" height="22" rx="4" fill="#233a62" />
        <path d="M66 72v20M50 92h32" stroke="#10233f" strokeWidth="6" strokeLinecap="round" />
        <circle cx="38" cy="42" r="3" fill="#ff5a3c" />
      </svg>
    )
  }
  if (kind === 'printer') {
    return (
      <svg {...common} aria-label="Ticket printer">
        <rect x="36" y="14" width="68" height="34" rx="3" fill="#fff" stroke="#d3e0f5" />
        <rect x="44" y="22" width="30" height="4" rx="2" fill="#b5c6e3" />
        <rect x="44" y="32" width="46" height="4" rx="2" fill="#b5c6e3" />
        <rect x="18" y="44" width="104" height="52" rx="12" fill="#10233f" />
        <rect x="28" y="52" width="84" height="8" rx="4" fill="#233a62" />
        <circle cx="100" cy="80" r="5" fill="#19b63d" />
        <rect x="28" y="74" width="30" height="8" rx="4" fill="#233a62" />
      </svg>
    )
  }
  return (
    <svg {...common} aria-label="Reader">
      <rect x="46" y="14" width="68" height="92" rx="12" fill="#10233f" />
      <rect x="56" y="24" width="48" height="26" rx="5" fill="#19b63d" />
      <path d="M68 38h24M80 30v16" stroke="#fff" strokeWidth="3.500" strokeLinecap="round" />
      <path d="M62 66c6-6 30-6 36 0M68 74c4-4 20-4 24 0" fill="none" stroke="#4f8df0" strokeWidth="3" strokeLinecap="round" />
      <circle cx="80" cy="92" r="5" fill="#fc7800" />
    </svg>
  )
}

// A tiny map of India-style pins for "where we run" is not drawn; this is a generic map card instead.
export function MapArt({ className = '' }) {
  const pins = [[70, 60], [150, 90], [230, 50], [120, 150], [210, 140], [290, 110], [60, 130]]
  return (
    <svg viewBox="0 0 360 200" role="img" aria-label="A map with parking locations marked" className={className}>
      <rect width="360" height="200" rx="16" fill="#e8f1ff" />
      <g stroke="#fff" strokeWidth="9" strokeLinecap="round" fill="none">
        <path d="M-10 70C60 80 120 40 190 70S300 100 370 60" />
        <path d="M60 -10C80 60 40 120 90 210" />
        <path d="M200 -10C190 50 240 110 220 210" />
      </g>
      <g fill="#cfe0fb">
        <rect x="100" y="86" width="40" height="30" rx="5" />
        <rect x="248" y="120" width="50" height="34" rx="5" />
        <rect x="20" y="20" width="44" height="30" rx="5" />
      </g>
      {pins.map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <path d="M0 0c-8-10-13-17-13-24a13 13 0 1 1 26 0c0 7-5 14-13 24Z" fill={i % 3 === 0 ? '#fc7800' : '#1867e1'} />
          <circle cy="-24" r="5" fill="#fff" />
        </g>
      ))}
    </svg>
  )
}
