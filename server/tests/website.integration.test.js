// API tests for the public website: enquiries, FAQ and blog. Needs MongoDB.
process.env.LEAD_RATE_LIMIT_MAX = "6";

const { setup, it, api, registerCompany, login, assert } = require("./helpers");
const User = require("../models/User");
const Lead = require("../models/Lead");

setup();

const s = {};
const lead = (extra = {}) => ({ name: "Ravi Kumar", email: "ravi@example.com", message: "Please call me about a demo.", ...extra });

it("setup: a platform admin and an ordinary company admin", async () => {
  await User.create({ name: "Root", email: "root@website.test", password: "RootPassword123", role: "SUPER_ADMIN" });
  s.root = await login("root@website.test", "RootPassword123");
  s.company = await registerCompany("web");
});

it("enquiry: anyone can send one; it is stored as NEW", async () => {
  const res = await api("POST", "/api/leads", {
    body: lead({ phone: "+91 98765 43210", company: "City Mall", type: "DEMO", subject: "Growth plan", status: "CLOSED", notes: "injected" }),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.match(res.body.message, /Thank you/);
  assert.equal(res.body.data, undefined); // nothing about the stored record is returned

  const stored = await Lead.findOne({ email: "ravi@example.com" });
  assert.equal(stored.status, "NEW"); // status and notes cannot be set by the sender
  assert.equal(stored.notes, undefined);
  assert.equal(stored.type, "DEMO");
  assert.equal(stored.subject, "Growth plan");
});

it("enquiry: bad input is refused, spam is dropped quietly, floods are limited", async () => {
  assert.equal((await api("POST", "/api/leads", { body: { name: "R", email: "nope" } })).status, 400);
  assert.equal((await api("POST", "/api/leads", { body: lead({ phone: "call me" }) })).status, 400);
  assert.equal((await api("POST", "/api/leads", { body: lead({ type: "HACK" }) })).status, 400);
  // A database operator is refused before it reaches the enquiry route, so it does not use up this route's limit.
  assert.equal((await api("POST", "/api/leads", { body: lead({ email: { $gt: "" } }) })).status, 400);
  assert.equal((await api("POST", "/api/leads", { body: lead({ email: "nope-again" }) })).status, 400);

  // The hidden "website" field is filled only by bots: looks successful, stores nothing.
  const spam = await api("POST", "/api/leads", { body: lead({ email: "bot@example.com", website: "http://spam.example" }) });
  assert.equal(spam.status, 201);
  assert.equal(await Lead.countDocuments({ email: "bot@example.com" }), 0);

  // Six requests were allowed in this window; the seventh is refused.
  const seventh = await api("POST", "/api/leads", { body: lead({ email: "seven@example.com" }) });
  assert.equal(seventh.status, 429);
  assert.equal(await Lead.countDocuments(), 1);
});

it("enquiries: only the platform admin can read and follow them up", async () => {
  assert.equal((await api("GET", "/api/leads")).status, 401);
  assert.equal((await api("GET", "/api/leads", { token: s.company.token })).status, 403);

  const list = await api("GET", "/api/leads", { token: s.root });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.newCount, 1);
  assert.equal(list.body.data.leads[0].ip, undefined);
  const id = list.body.data.leads[0]._id;

  assert.equal((await api("PUT", `/api/leads/${id}`, { token: s.company.token, body: { status: "CLOSED" } })).status, 403);
  assert.equal((await api("PUT", `/api/leads/${id}`, { token: s.root, body: { status: "DONE" } })).status, 400);
  const updated = await api("PUT", `/api/leads/${id}`, { token: s.root, body: { status: "CONTACTED", notes: "Called, demo on Friday", email: "changed@example.com" } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.status, "CONTACTED");
  assert.equal(updated.body.data.email, "ravi@example.com"); // what the visitor sent cannot be edited

  assert.equal((await api("GET", "/api/leads?status=NEW", { token: s.root })).body.data.total, 0);
  assert.equal((await api("GET", "/api/leads?status=CONTACTED", { token: s.root })).body.data.total, 1);
});

it("FAQ: the public sees published questions; only the platform admin edits", async () => {
  const create = (body, token = s.root) => api("POST", "/api/faq", { token, body });
  assert.equal((await create({ question: "Is it free?", answer: "There is a free trial." }, s.company.token)).status, 403);
  assert.equal((await api("POST", "/api/faq", { body: { question: "Is it free?", answer: "Yes." } })).status, 401);
  assert.equal((await create({ question: "Hi?" })).status, 400);

  const pricing = await create({ question: "Is there a free trial?", answer: "Yes, 14 days.", category: "Pricing", order: 2 });
  assert.equal(pricing.status, 201, JSON.stringify(pricing.body));
  await create({ question: "How do I start?", answer: "Register your company.", category: "Getting started" });
  await create({ question: "What does it cost?", answer: "See the pricing section.", category: "Pricing", order: 1 });
  const draft = await create({ question: "Unfinished question?", answer: "Not ready yet.", isPublished: false });

  const open = await api("GET", "/api/faq");
  assert.equal(open.status, 200);
  assert.deepEqual(open.body.data.map((f) => f.question), ["How do I start?", "What does it cost?", "Is there a free trial?"]);

  assert.equal((await api("GET", "/api/faq/all", { token: s.root })).body.data.length, 4);
  assert.equal((await api("GET", "/api/faq/all", { token: s.company.token })).status, 403);

  const id = draft.body.data._id;
  const published = await api("PUT", `/api/faq/${id}`, { token: s.root, body: { isPublished: true } });
  assert.equal(published.body.data.isPublished, true);
  assert.equal((await api("GET", "/api/faq")).body.data.length, 4);
  assert.equal((await api("DELETE", `/api/faq/${id}`, { token: s.company.token })).status, 403);
  assert.equal((await api("DELETE", `/api/faq/${id}`, { token: s.root })).status, 200);
  assert.equal((await api("DELETE", `/api/faq/${id}`, { token: s.root })).status, 404);
  assert.equal((await api("GET", "/api/faq")).body.data.length, 3);
});

it("testimonials: the public sees published quotes; only the platform admin edits", async () => {
  const create = (body, token = s.root) => api("POST", "/api/testimonials", { token, body });
  assert.equal((await create({ quote: "Works well for our mall.", name: "A. Kumar" }, s.company.token)).status, 403);
  assert.equal((await api("POST", "/api/testimonials", { body: { quote: "Works well for our mall.", name: "A. Kumar" } })).status, 401);
  assert.equal((await create({ quote: "short", name: "A. Kumar" })).status, 400);

  const first = await create({ quote: "Entry and exit became much faster.", name: "R. Singh", role: "Parking manager", company: "City Mall", order: 2 });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  await create({ quote: "The reports save us an hour every day.", name: "P. Rao", order: 1 });
  const draft = await create({ quote: "A quote that is not approved yet.", name: "S. Das", isPublished: false });

  const open = await api("GET", "/api/testimonials");
  assert.equal(open.status, 200);
  assert.deepEqual(open.body.data.map((t) => t.name), ["P. Rao", "R. Singh"]);
  assert.equal((await api("GET", "/api/testimonials/all", { token: s.root })).body.data.length, 3);
  assert.equal((await api("GET", "/api/testimonials/all", { token: s.company.token })).status, 403);

  const id = draft.body.data._id;
  assert.equal((await api("PUT", `/api/testimonials/${id}`, { token: s.root, body: { isPublished: true } })).body.data.isPublished, true);
  assert.equal((await api("GET", "/api/testimonials")).body.data.length, 3);
  assert.equal((await api("DELETE", `/api/testimonials/${id}`, { token: s.company.token })).status, 403);
  assert.equal((await api("DELETE", `/api/testimonials/${id}`, { token: s.root })).status, 200);
  assert.equal((await api("DELETE", `/api/testimonials/${id}`, { token: s.root })).status, 404);
});

it("public stats: real counts, no login needed", async () => {
  const res = await api("GET", "/api/public/stats");
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.data.locations, "number");
  assert.equal(typeof res.body.data.vehicles30d, "number");
});

it("blog: drafts are hidden, slugs are unique, views are counted", async () => {
  const body = "This is the first paragraph of the article.\n\n## A heading\n\nAnd a second paragraph.";
  const create = (extra, token = s.root) =>
    api("POST", "/api/blog", { token, body: { title: "Parking Tips for Operators", body, ...extra } });

  assert.equal((await create({}, s.company.token)).status, 403);
  assert.equal((await create({ body: "short" })).status, 400);
  assert.equal((await create({ tags: ["<script>"] })).status, 400);

  const first = await create({ category: "Operations", tags: ["Tips", "pricing"], isPublished: true, slug: "my-own-slug", views: 999 });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.data.slug, "parking-tips-for-operators"); // made by the server
  assert.equal(first.body.data.views, 0);
  assert.deepEqual(first.body.data.tags, ["tips", "pricing"]);
  assert.ok(first.body.data.publishedAt);

  const second = await create({ category: "Management", isPublished: true });
  assert.equal(second.body.data.slug, "parking-tips-for-operators-2");
  const draft = await create({ title: "A draft article about parking" });
  assert.equal(draft.body.data.isPublished, false);
  assert.equal(draft.body.data.publishedAt, undefined);

  const list = await api("GET", "/api/blog");
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.data.total, 2);
  assert.equal(list.body.data.posts[0].body, undefined); // the list does not carry full articles
  assert.deepEqual(list.body.data.categories, ["Management", "Operations"]);
  assert.deepEqual(list.body.data.tags, ["pricing", "tips"]);
  assert.equal((await api("GET", "/api/blog?category=operations")).body.data.total, 1);
  assert.equal((await api("GET", "/api/blog?tag=TIPS")).body.data.total, 1);
  assert.equal((await api("GET", `/api/blog?category=${encodeURIComponent(".*")}`)).body.data.total, 0);

  const read = await api("GET", "/api/blog/parking-tips-for-operators");
  assert.equal(read.status, 200);
  assert.equal(read.body.data.body, body);
  assert.equal(read.body.data.views, 1);
  assert.equal((await api("GET", "/api/blog/parking-tips-for-operators")).body.data.views, 2);

  // Drafts and unknown articles are not readable by the public.
  assert.equal((await api("GET", `/api/blog/${draft.body.data.slug}`)).status, 404);
  assert.equal((await api("GET", "/api/blog/does-not-exist")).status, 404);
  assert.equal((await api("GET", "/api/blog/admin/all")).status, 401);
  assert.equal((await api("GET", "/api/blog/admin/all", { token: s.root })).body.data.length, 3);

  // Publishing a draft; the slug stays the same when the title changes.
  const id = draft.body.data._id;
  const published = await api("PUT", `/api/blog/${id}`, { token: s.root, body: { isPublished: true, title: "A finished article about parking" } });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal(published.body.data.slug, draft.body.data.slug);
  assert.ok(published.body.data.publishedAt);
  assert.equal((await api("GET", "/api/blog")).body.data.total, 3);

  assert.equal((await api("PUT", `/api/blog/${id}`, { token: s.company.token, body: { title: "Hacked title here" } })).status, 403);
  assert.equal((await api("DELETE", `/api/blog/${id}`, { token: s.root })).status, 200);
  assert.equal((await api("GET", "/api/blog")).body.data.total, 2);
});
