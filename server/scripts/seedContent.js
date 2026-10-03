// Adds starter FAQs and blog articles for the public website.
// Run once:  npm run seed:content
// It only fills collections that are empty, so it never overwrites your edits.
const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

require("dotenv").config();

const mongoose = require("mongoose");
const FAQ = require("../models/FAQ");
const Blog = require("../models/Blog");
const { slugify } = require("../utils/slug");

const FAQS = [
  ["Getting started", "What is Smart Parking SaaS?", "It is software for running paid parking: staff record each vehicle's entry and exit, the system works out the fee from your tariff, records the payment and gives a receipt. Owners see occupancy, revenue and staff activity on a dashboard."],
  ["Getting started", "How do I start?", "Register your company, create your first parking location, set its capacity and a tariff for each vehicle type, then add your operators. You can take the first vehicle in a few minutes."],
  ["Getting started", "Do I need any hardware?", "No. Operators can work from any phone, tablet or computer with a web browser. A printer is optional, for paper tickets and receipts."],
  ["Getting started", "Can I manage more than one parking location?", "Yes. Each location has its own capacity, tariffs and staff, and the dashboard and reports can show one location or all of them together."],
  ["Pricing and tariffs", "How are parking fees calculated?", "You define a tariff per location and vehicle type: a grace period, duration slabs, an hourly rate after the last slab, a daily maximum, an overnight charge, a lost-ticket penalty and tax. The fee is always calculated by the system, not by the operator."],
  ["Pricing and tariffs", "Can I charge different rates on weekends?", "Yes. A tariff can be limited to chosen days of the week. On those days it is used instead of your standard tariff."],
  ["Payments", "Which payment methods are supported?", "Cash, UPI and card payments are recorded by the operator at the gate. Online payment through a gateway is planned."],
  ["Payments", "How do I know my cash matches?", "Operators start a shift with their opening cash and count the drawer at the end. The system compares the count with what it expected and alerts the admin when there is a difference."],
  ["Security", "Can operators see my revenue?", "Only if you give them a role that allows it. Entry operators can create tickets, exit operators can take payments, and reports are limited to the roles and locations you choose."],
  ["Security", "Is my data separate from other companies?", "Yes. Every record belongs to one company, and each request can only read or change the records of the signed-in user's company."],
  ["Operations", "What happens if a customer loses the ticket?", "The operator finds the vehicle by its number and marks the ticket as lost. The lost-ticket penalty from your tariff is added to the parking fee."],
  ["Operations", "Can I export my data?", "Yes. Revenue, collection, vehicle history, occupancy and operator reports can each be downloaded as a CSV file for any period."],
];

const POSTS = [
  {
    title: "How to set parking tariffs that are simple to explain",
    category: "Operations",
    tags: ["tariffs", "pricing"],
    excerpt: "A tariff that customers understand at a glance causes fewer disputes at the exit gate. Here is a simple way to structure one.",
    body: `Most arguments at an exit gate are about the fee. A tariff that a customer can read on a board and work out for themselves prevents most of them.

## Start with slabs, not a formula

Slabs are easy to explain: up to 1 hour, up to 3 hours, and so on. State each slab as the total to pay for that stay, not as an amount to add. "Up to 3 hours: 50" is clearer than "20 for the first hour and 15 for each hour after".

## Decide what happens after the last slab

Long stays need a rule too. A per-hour rate after the last slab, together with a maximum per 24 hours, keeps long stays fair and predictable.

## Give a short grace period

A few free minutes for vehicles that enter and leave straight away avoids charging people who could not find a space or came in by mistake.

## Write down the exceptions

Decide the lost-ticket penalty and any overnight charge in advance and display them. Staff should never have to make up an amount.

## Check it with real stays

Before you publish a tariff, calculate a few typical visits: 20 minutes, 2 hours, a full working day and an overnight stay. If any result surprises you, it will surprise your customers too.`,
  },
  {
    title: "Closing the cash gap: shift reconciliation for parking operators",
    category: "Operations",
    tags: ["cash", "shifts", "reconciliation"],
    excerpt: "Small cash differences add up over a month. A short routine at the start and end of every shift keeps them visible.",
    body: `Cash handling is where a parking business most often loses money without noticing. The fix is a routine, not a suspicion.

## Count at the start

Every shift starts by counting the cash already in the drawer and recording it. Without an opening figure, no closing figure means anything.

## Record every payment as it happens

Each payment should be tied to a ticket and to the person who took it. If a payment can be taken without a record, the record is no longer a control.

## Count at the end, before looking

At the end of the shift the operator counts the drawer and enters the amount before seeing what the system expected. Counting first keeps the count honest.

## Look at the difference every day

Expected cash is the opening cash, plus cash collected, minus cash refunds. Compare it with the count. A small difference now and then is normal. The same person being short every week is a pattern to look into.

## Keep corrections visible

Refunds, cancelled tickets and vehicles let out without payment should need a reason and be visible to the owner. Most are legitimate, and seeing them is what makes that clear.`,
  },
  {
    title: "Five numbers every parking owner should check each morning",
    category: "Management",
    tags: ["dashboard", "reports"],
    excerpt: "You do not need a long report to know how yesterday went. These five figures tell you most of it.",
    body: `A daily check takes five minutes when you know what to look for.

## 1. Vehicles in and out

Entries and exits for the day show demand. Compare them with the same weekday last week, not with yesterday.

## 2. Peak occupancy

How full did you get, and at what hour? If you are full for hours, you are turning vehicles away. If you never pass half, the pricing or the signage may need attention.

## 3. Revenue after refunds

Look at the net figure, and at how it splits between cash and digital payments.

## 4. Exceptions

Lost tickets, cancelled entries and exits without payment. A handful is normal. A sudden rise deserves a question.

## 5. Cash differences

Whether each shift's counted cash matched what was expected.

None of these needs a spreadsheet. If your system shows them on one screen, the morning check becomes a habit.`,
  },
];

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("Set MONGO_URI in server/.env first");
  await mongoose.connect(process.env.MONGO_URI);

  if (await FAQ.estimatedDocumentCount()) {
    console.log("FAQs already exist. Left unchanged.");
  } else {
    const order = {};
    await FAQ.insertMany(
      FAQS.map(([category, question, answer]) => {
        order[category] = (order[category] || 0) + 1;
        return { category, question, answer, order: order[category] };
      })
    );
    console.log(`Added ${FAQS.length} FAQs.`);
  }

  if (await Blog.estimatedDocumentCount()) {
    console.log("Blog articles already exist. Left unchanged.");
  } else {
    const now = Date.now();
    await Blog.insertMany(
      POSTS.map((post, i) => ({
        ...post,
        slug: slugify(post.title),
        author: "Smart Parking Team",
        isPublished: true,
        publishedAt: new Date(now - i * 24 * 60 * 60 * 1000),
      }))
    );
    console.log(`Added ${POSTS.length} blog articles.`);
  }
};

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
