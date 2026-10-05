// Content of the public website: features, how it works, plans and hardware.
// Keep "available" honest: only mark a feature available when it is built.

export const FEATURES = [
  { title: 'Entry and exit', text: 'Create a ticket in seconds, find a vehicle by ticket or number, and close the visit at exit.', available: true },
  { title: 'Automatic fee calculation', text: 'Grace period, duration slabs, hourly rate, daily maximum, overnight charge, lost-ticket penalty and tax.', available: true },
  { title: 'Payments and receipts', text: 'Record cash, UPI and card payments and give a printable receipt for every exit.', available: true },
  { title: 'Live dashboard', text: 'Occupancy, entries and exits by hour, revenue and alerts, for one location or all of them.', available: true },
  { title: 'Shifts and cash reconciliation', text: 'Operators open and close shifts; counted cash is compared with expected cash.', available: true },
  { title: 'Reports and export', text: 'Revenue, collection, vehicle history, occupancy and operator reports, with CSV download.', available: true },
  { title: 'Multi-location', text: 'Each location has its own capacity, tariffs, gates and staff under one company account.', available: true },
  { title: 'Roles and audit log', text: 'Six roles with separate permissions, and a permanent record of every important action.', available: true },
  { title: 'Number plate recognition (ANPR)', text: 'A gate camera reads the number plate and fills the vehicle number by itself. Entry and exit can run automatically for clear readings.', available: true },
  { title: 'Passes and bookings', text: 'Monthly passes with pass tags, customer bookings, and advance payments taken at entry.', available: true },
  { title: 'Online payment', text: 'A pay link with a QR code at exit. It connects to your payment gateway, and the barrier opens when the payment arrives.', available: true },
  { title: 'Gate hardware', text: 'Boom barrier, ticket and receipt printer, pass-tag readers and gate cameras, each tied to a gate and watched for online or offline.', available: true },
  { title: 'FASTag payments', text: 'FASTag readers can be connected and the plate or tag is read at the gate. Collecting the fee from FASTag needs a bank partner and is not available yet.', available: false },
  { title: 'Valet management', text: 'Drivers, keys, bays and vehicle retrieval requests.', available: false },
]

export const WORKFLOW = [
  { title: 'Vehicle arrives', text: 'The operator enters the vehicle number and type. The system checks capacity and creates a ticket.' },
  { title: 'Vehicle is parked', text: 'The visit is live on the dashboard and counted in occupancy.' },
  { title: 'Vehicle leaves', text: 'The operator finds it by ticket or number. The fee is calculated from your tariff.' },
  { title: 'Payment and receipt', text: 'The payment is recorded, the receipt is ready to print, and reports update.' },
]

// Prices and plans. Prices are before GST. Change PRICING to change the plan cards and the calculator.
export const PRICING = {
  parkingPerUserMonth: 499,
  valetPerUserMonth: 699,
  gstPercent: 18,
  // Months of a plan and the discount for paying for that many months at once.
  tenures: [
    { months: 1, discount: 0 },
    { months: 3, discount: 5 },
    { months: 6, discount: 10 },
    { months: 12, discount: 20 },
    { months: 24, discount: 30 },
    { months: 36, discount: 40 },
    { months: 48, discount: 45 },
    { months: 60, discount: 50 },
  ],
}

export const PLANS = [
  {
    name: 'Free trial',
    price: 'Free for 14 days',
    summary: 'Try the full product with your own parking.',
    limits: ['Up to 2 locations', 'Up to 10 users', 'All current features'],
    cta: { label: 'Start free trial', to: '/register' },
  },
  {
    name: 'Parking Management',
    price: `₹${PRICING.parkingPerUserMonth} / user / month`,
    note: 'Plus GST. Pay for more months at once and the price drops: see the calculator below.',
    summary: 'The complete system for entry, exit, payments and reports.',
    limits: [
      'Entry, exit, fees and receipts',
      'Number plate reading and automatic entry and exit',
      'Passes, bookings and online payment',
      'Shifts, reports and live dashboard',
      'Boom barrier, printer and reader connections',
      'Multiple locations, roles and audit log',
    ],
    cta: { label: 'Buy this plan', to: '/dashboard/billing?users=1&months=12' },
    highlighted: true,
  },
  {
    name: 'Valet Management',
    price: `₹${PRICING.valetPerUserMonth} / user / month`,
    note: 'Planned price. Valet management is not available yet.',
    summary: 'Drivers, keys, bays and vehicle retrieval requests.',
    limits: ['Key and bay tracking', 'Driver assignment', 'Customer retrieval requests'],
    cta: { label: 'Tell me when it is ready', to: '/contact?plan=Valet' },
    comingLater: true,
  },
  {
    name: 'Enterprise',
    price: null,
    summary: 'For large or multi-city operations.',
    limits: ['Unlimited locations by agreement', 'Onboarding support', 'Priority on integrations'],
    cta: { label: 'Contact us', to: '/contact?plan=Enterprise' },
  },
]

// How a vehicle moves through a gate that has hardware. FASTag shows the reader only: the fee is not collected from it yet.
export const GATE_FLOW = [
  { title: 'Vehicle arrives', text: 'An ANPR camera reads the number plate, or the operator types it. A pass tag or FASTag reader can identify the vehicle too.' },
  { title: 'Barrier opens', text: 'The ticket is created and printed, and the boom barrier opens after the vehicle is checked.' },
  { title: 'Software keeps track', text: 'Live dashboard, vehicle tracking, reports, staff roles and alerts for every location.' },
  { title: 'Payment and exit', text: 'Pay by cash, UPI or card, or by the online pay link. The exit barrier opens once the fee is settled.' },
]

// Shown on the FAQ page until you add your own questions in Dashboard > Website.
export const DEFAULT_FAQS = [
  { category: 'Getting started', question: 'Do I need special hardware to start?', answer: 'No. The software runs in any web browser, and an operator can issue tickets and take payments from a normal computer. Cameras, barriers, printers and readers are optional additions, and we can supply and install them for you.' },
  { category: 'Getting started', question: 'How does the free trial work?', answer: 'You get 14 days free with up to 2 locations and 10 users, with all current features. No card is needed to start. When the trial ends you can choose a paid plan.' },
  { category: 'Getting started', question: 'Can I run more than one parking location?', answer: 'Yes. Each location has its own capacity, tariffs, gates and staff, and the dashboard shows one location or all of them together.' },
  { category: 'Gate operations', question: 'How does number plate reading work?', answer: 'A camera at the gate reads the number plate and fills the vehicle number for you. With automatic entry switched on, a clear reading creates the ticket, prints it and opens the barrier by itself. A doubtful reading is flagged for the operator to check.' },
  { category: 'Gate operations', question: 'What if the ticket is lost?', answer: 'At exit the operator ticks "Ticket is lost", types the vehicle number and presses Enter. The lost-ticket charge you set in the tariff is added to the fee.' },
  { category: 'Gate operations', question: 'Can customers book a space in advance?', answer: 'Yes. A parking can switch on online booking. The customer picks a time, can pay the booking fee online, and the fee is set against the parking charge when they arrive.' },
  { category: 'Payments and reports', question: 'Which ways of paying are supported?', answer: 'Cash, UPI and card are recorded at the gate, and an online pay link with a QR code connects to your payment gateway. FASTag readers can identify vehicles, but collecting the fee from FASTag is not available yet.' },
  { category: 'Payments and reports', question: 'How do I know the cash at the end of a shift is right?', answer: 'Operators open and close shifts. The software compares the cash they counted with the cash it expected and shows any difference.' },
  { category: 'Payments and reports', question: 'Can I export reports?', answer: 'Yes. Revenue, collection, vehicle history, occupancy and operator reports can be downloaded as CSV, Excel or PDF.' },
  { category: 'Passes', question: 'Can regular customers have monthly passes?', answer: 'Yes. You can create monthly passes with pass tags for regular vehicles, and the gate recognises the pass at entry and exit.' },
  { category: 'Account and security', question: 'Who can see what?', answer: 'Every person has a role with its own permissions, so a gate operator sees only the gate screens. Important actions are written to an audit log that cannot be edited.' },
]

// Hardware integrations. `available: true` only when the software already works with it; the rest is
// marked planned and lets visitors register their interest.
export const PRODUCTS = [
  { name: 'Boom barrier', category: 'Access control', text: 'Opens automatically when entry is recorded or payment is confirmed.', available: true },
  { name: 'ANPR camera', category: 'Cameras', text: 'Reads the number plate at entry and exit so nothing is typed.', available: true },
  { name: 'Thermal ticket printer', category: 'Printing', text: 'Prints tickets and receipts at the gate.', available: true },
  { name: 'UHF / RFID reader', category: 'Access control', text: 'Hands-free entry for vehicles with a tag or pass.', available: true },
  { name: 'CCTV integration', category: 'Cameras', text: 'Links camera footage to entries and exits.', available: true },
  { name: 'FASTag reader', category: 'Payments', text: 'Reads the vehicle\'s FASTag at the gate. Collecting the fee from FASTag is not available yet.', available: true },
  { name: 'Handheld terminal', category: 'Devices', text: 'A rugged device for operators working away from a booth.', available: false },
  { name: 'LED availability display', category: 'Displays', text: 'Shows free spaces to drivers before they enter.', available: false },
]
