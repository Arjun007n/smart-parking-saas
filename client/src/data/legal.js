// The Privacy Policy and the Terms, as plain sections. This is a working draft written from what the
// software actually does. Have a lawyer read it before you rely on it, and set `legalName`,
// `jurisdiction` and `refundPolicy` in config/site.js so the placeholders below are filled in.

export const LEGAL_UPDATED = '5 October 2026'

export const privacySections = (site) => {
  const who = site.legalName || site.name
  return [
    {
      title: 'Who we are',
      body: [
        `${who} ("we", "us") provides parking management software. This policy explains what information we collect when you use our website and our software, why we collect it, and the choices you have.`,
        'It covers two groups of people: the businesses and staff who use the software, and the drivers whose vehicles pass through a parking location that uses the software.',
      ],
    },
    {
      title: 'What we collect',
      list: [
        'Account details: your name, email address, phone number, company name and role, and a password that we store only in scrambled (hashed) form.',
        'Business details you enter: parking locations, tariffs, staff, GST number and billing address.',
        'Parking records: vehicle number, vehicle type, entry and exit times, tickets, fees, payments and receipts. Where a camera is installed, the photo of the vehicle and the number plate read from it.',
        'Booking details: the name, mobile number, vehicle number and expected arrival time that a customer gives when booking a space.',
        'Enquiries: what you send us through the contact form, including your name, email and phone number.',
        'Technical data: a log of important actions in the software (who did what and when) and basic information such as your browser type, used to keep the service secure.',
      ],
    },
    {
      title: 'Why we use it',
      list: [
        'To run the software: create tickets, calculate fees, take payments, print receipts and produce reports.',
        'To keep the service safe: sign-in security, rate limits and the audit log.',
        'To contact you: confirmations, payment and booking messages, alerts you asked for, and replies to your enquiries.',
        'To improve the product, using counts and summaries rather than individual records wherever possible.',
      ],
    },
    {
      title: 'Who sees the information',
      body: [
        'The parking records of a business belong to that business. Its own staff see them according to the role they were given. We do not sell your information and we do not show one business\'s records to another.',
        'We use other companies to deliver parts of the service: hosting and database providers, payment gateways, and email and SMS or WhatsApp providers. They receive only what they need to do their job, such as an amount and a payment reference for a payment, or a phone number and a message for a text. We may also share information when the law requires it.',
      ],
    },
    {
      title: 'How long we keep it',
      body: [
        'We keep records for as long as the account is active, and for the period the law requires for accounting records afterwards. A business can ask us to delete its data when it closes its account, subject to those legal periods.',
      ],
    },
    {
      title: 'Security',
      body: [
        'Connections to the service are encrypted, passwords are hashed, access is limited by role, and important actions are written to an audit log. No system is perfectly secure, so please use a strong password and tell us at once if you suspect misuse of your account.',
      ],
    },
    {
      title: 'Your choices',
      body: [
        'You can ask us to show you, correct or delete the personal information we hold about you. If you are a driver, the business that runs the parking location is usually the one that holds your records, and we will help you reach them. To make a request, use the contact details below.',
      ],
    },
    {
      title: 'Cookies and storage',
      body: [
        'We use your browser\'s storage to keep you signed in and to remember small choices such as the theme or sound setting on the gate screens. We do not use it for advertising.',
      ],
    },
    {
      title: 'Changes',
      body: [`We may update this policy. The date at the top shows when it last changed. Continuing to use the service after a change means you accept the new version.`],
    },
  ]
}

export const termsSections = (site) => {
  const who = site.legalName || site.name
  return [
    {
      title: 'Using the service',
      body: [
        `These terms are between you and ${who}. By creating an account or using our website, software or mobile screens, you agree to them.`,
        'You must give accurate information, keep your password private, and be responsible for what happens under your account, including what your staff do.',
      ],
    },
    {
      title: 'What you may not do',
      list: [
        'Break the law or use the service to harm others.',
        'Try to get into accounts or data that are not yours, or to disturb the service.',
        'Copy, resell or reverse-engineer the software, unless we have agreed in writing.',
        'Upload content you have no right to use.',
      ],
    },
    {
      title: 'Plans, prices and payment',
      body: [
        'Paid plans are charged per user per month, or for the period you choose, at the price shown when you subscribe. Prices are before GST and other applicable taxes, which are added at checkout.',
        'A free trial lets you try the service for the period shown on the site. When it ends you can choose a paid plan; if you do not, the account may be limited or closed.',
        ...(site.refundPolicy ? [site.refundPolicy] : []),
      ],
    },
    {
      title: 'Hardware',
      body: [
        'Hardware such as cameras, barriers, printers and readers is sold by us or by our partners at the price and on the warranty shown with the product. Delivery and installation are arranged with you when you order. Hardware is not required to use the software.',
      ],
    },
    {
      title: 'Your data',
      body: [
        'You keep ownership of the data you put into the service. You allow us to store and process it to provide the service, as described in our Privacy Policy. Where you record the vehicle numbers or photos of drivers, you are responsible for having the right to do so and for telling drivers where the law requires it.',
      ],
    },
    {
      title: 'Availability and changes',
      body: [
        'We work to keep the service available but cannot promise it will never be interrupted. Cameras, barriers and payment providers depend on equipment and networks outside our control. We may improve or change features, and will tell you about a change that materially affects you.',
      ],
    },
    {
      title: 'Our responsibility',
      body: [
        'The service is provided as it is. To the extent the law allows, we are not responsible for indirect loss, such as lost income or a vehicle that left without payment because of a setting, a device or a network fault. Our total responsibility for any claim is limited to the amount you paid us in the three months before the claim.',
      ],
    },
    {
      title: 'Ending the agreement',
      body: [
        'You can stop using the service at any time. We may suspend or close an account that breaks these terms or is not paid. When an account closes, we handle its data as described in the Privacy Policy.',
      ],
    },
    {
      title: 'Law',
      body: [
        site.jurisdiction
          ? `These terms are governed by the laws of India. Courts at ${site.jurisdiction} have jurisdiction over any dispute.`
          : 'These terms are governed by the laws of India.',
      ],
    },
  ]
}
