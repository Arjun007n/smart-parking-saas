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
  { title: 'Number plate recognition (ANPR)', text: 'Read vehicle numbers from a camera at the gate.', available: false },
  { title: 'FASTag payments', text: 'Collect parking fees through FASTag.', available: false },
  { title: 'Valet management', text: 'Drivers, keys, bays and vehicle retrieval requests.', available: false },
  { title: 'Passes and online payment', text: 'Monthly passes and payment through an online gateway.', available: false },
]

export const WORKFLOW = [
  { title: 'Vehicle arrives', text: 'The operator enters the vehicle number and type. The system checks capacity and creates a ticket.' },
  { title: 'Vehicle is parked', text: 'The visit is live on the dashboard and counted in occupancy.' },
  { title: 'Vehicle leaves', text: 'The operator finds it by ticket or number. The fee is calculated from your tariff.' },
  { title: 'Payment and receipt', text: 'The payment is recorded, the receipt is ready to print, and reports update.' },
]

// Set `price` (for example '₹2,999 / month') when your pricing is decided.
// While it is null the site shows "Contact us for pricing".
export const PLANS = [
  {
    name: 'Free trial',
    price: 'Free for 14 days',
    summary: 'Try the full product with your own parking.',
    limits: ['Up to 2 locations', 'Up to 10 users', 'All current features'],
    cta: { label: 'Start free trial', to: '/register' },
    highlighted: true,
  },
  {
    name: 'Standard',
    price: null,
    summary: 'For operators running one or a few locations.',
    limits: ['Locations and users as agreed', 'Dashboard, reports and CSV export', 'Shifts and cash reconciliation'],
    cta: { label: 'Contact us', to: '/contact?plan=Standard' },
  },
  {
    name: 'Enterprise',
    price: null,
    summary: 'For large or multi-city operations.',
    limits: ['Unlimited locations by agreement', 'Onboarding support', 'Priority on integrations'],
    cta: { label: 'Contact us', to: '/contact?plan=Enterprise' },
  },
]

// Hardware integrations are planned, not yet available. The page says so and
// lets visitors register their interest.
export const PRODUCTS = [
  { name: 'Boom barrier', category: 'Access control', text: 'Opens automatically when entry is recorded or payment is confirmed.' },
  { name: 'ANPR camera', category: 'Cameras', text: 'Reads the number plate at entry and exit so nothing is typed.' },
  { name: 'Thermal ticket printer', category: 'Printing', text: 'Prints tickets and receipts at the gate.' },
  { name: 'Handheld terminal', category: 'Devices', text: 'A rugged device for operators working away from a booth.' },
  { name: 'UHF / RFID reader', category: 'Access control', text: 'Hands-free entry for vehicles with a tag or pass.' },
  { name: 'LED availability display', category: 'Displays', text: 'Shows free spaces to drivers before they enter.' },
  { name: 'FASTag reader', category: 'Payments', text: 'Collects the parking fee from the vehicle\'s FASTag.' },
  { name: 'CCTV integration', category: 'Cameras', text: 'Links camera footage to entries and exits.' },
]
