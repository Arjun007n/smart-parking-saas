// The starter hardware list: the same eight items the website has always shown, with NO price.
// The Super Admin imports it once (Dashboard > Shop > Import starter list) and then sets prices,
// GST rates, HSN codes and stock. Nothing can be ordered online until a price is set.
module.exports = [
  { name: "Boom barrier", category: "Access control", description: "Opens automatically when entry is recorded or payment is confirmed.", worksWithSoftware: true, sortOrder: 10 },
  { name: "ANPR camera", category: "Cameras", description: "Reads the number plate at entry and exit so nothing is typed.", worksWithSoftware: true, sortOrder: 20 },
  { name: "Thermal ticket printer", category: "Printing", description: "Prints tickets and receipts at the gate.", worksWithSoftware: true, sortOrder: 30 },
  { name: "UHF / RFID reader", category: "Access control", description: "Hands-free entry for vehicles with a tag or pass.", worksWithSoftware: true, sortOrder: 40 },
  { name: "CCTV integration", category: "Cameras", description: "Links camera footage to entries and exits.", worksWithSoftware: true, sortOrder: 50 },
  { name: "FASTag reader", category: "Payments", description: "Reads the vehicle's FASTag at the gate. Collecting the fee from FASTag is not available yet.", worksWithSoftware: true, sortOrder: 60 },
  { name: "Handheld terminal", category: "Devices", description: "A rugged device for operators working away from a booth.", worksWithSoftware: false, sortOrder: 70 },
  { name: "LED availability display", category: "Displays", description: "Shows free spaces to drivers before they enter.", worksWithSoftware: false, sortOrder: 80 },
];
