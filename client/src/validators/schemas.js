import { z } from 'zod'

const email = z.string().trim().min(1, 'Email is required').email('Enter a valid email')
// Optional: empty is fine, anything else must look like an address.
const optionalEmail = z.string().trim().max(254).optional().refine((v) => !v || z.string().email().safeParse(v).success, 'Enter a valid email')
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
const count = z
  .number({ error: 'Enter a number' })
  .int('Enter a whole number')
  .min(0, 'Cannot be negative')
  .max(100000, 'Too large')

// Everyone signs in with their company code and either a Login ID or an email. (The platform's own
// administrator has no company and leaves the code empty; the server decides.)
export const loginSchema = z.object({
  companyCode: z.string().trim().max(20).optional(),
  identifier: z.string().trim().min(1, 'Enter your Login ID or email').max(254),
  password: z.string().min(1, 'Password is required'),
})

// A Login ID: 3 to 30 letters, digits, dots, dashes or underscores.
const loginId = z
  .string()
  .trim()
  .refine((v) => !v || /^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$/.test(v), 'Use 3 to 30 letters, digits, dots, dashes or underscores')

export const registerSchema = z
  .object({
    companyName: z.string().trim().min(2, 'Company name is required').max(150),
    // The code everyone in the company signs in with, chosen by the admin.
    companyCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{4,12}$/, 'Use 4 to 12 letters or digits, no spaces or symbols'),
    name: z.string().trim().min(2, 'Your name is required').max(100),
    email,
    phone: z.string().trim().max(20).optional(),
    gstNumber: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => v === '' || /^[0-9]{2}[A-Z0-9]{13}$/.test(v), 'GSTIN must be 15 characters')
      .optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    password,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })

export const forgotPasswordSchema = z.object({ email })

export const resetPasswordSchema = z
  .object({ password, confirmPassword: z.string() })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })

export const locationSchema = z.object({
  name: z.string().trim().min(2, 'Parking name is required').max(150),
  line1: z.string().trim().min(2, 'Address is required').max(200),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  pincode: z.string().trim().max(10).optional(),
  car: count,
  bike: count,
  heavy: count,
  taxi: count,
  tempo: count,
})

export const userSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(100),
  // A user needs an email or a Login ID (or both) to sign in with.
  email: optionalEmail,
  loginId: loginId.optional(),
  phone: z.string().trim().max(20).optional(),
  lanes: z.array(z.string()).optional(),
  password,
  role: z.string().min(1, 'Choose a role'),
  locationIds: z.array(z.string()),
  employeeCode: z.string().trim().max(30).optional(),
  shiftName: z.string().trim().max(50).optional(),
  shiftStart: z.union([z.literal(''), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time like 09:30')]).optional(),
  shiftEnd: z.union([z.literal(''), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time like 09:30')]).optional(),
  reprint: z.enum(['YES', 'NO']).optional(),
  showEntry: z.enum(['YES', 'NO']).optional(),
  showExit: z.enum(['YES', 'NO']).optional(),
  showTotal: z.enum(['YES', 'NO']).optional(),
}).refine((v) => Boolean(v.email || v.loginId), { path: ['loginId'], message: 'Enter a Login ID or an email' })

export const companySchema = z.object({
  name: z.string().trim().min(2, 'Company name is required').max(150),
  legalName: z.string().trim().max(200).optional(),
  businessType: z.string().trim().max(100).optional(),
  gstNumber: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === '' || /^[0-9]{2}[A-Z0-9]{13}$/.test(v), 'GSTIN must be 15 characters')
    .optional(),
  passGstPercent: z.number({ error: 'Enter a percentage, 0 for none' }).min(0, 'Cannot be negative').max(100, 'At most 100'),
  billingName: z.string().trim().max(100).optional(),
  billingEmail: z
    .string()
    .trim()
    .refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email')
    .optional(),
  billingPhone: z.string().trim().max(20).optional(),
  line1: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  pincode: z.string().trim().max(10).optional(),
})

// For optional number inputs: use with register(name, { setValueAs: toOptionalNumber }).
export const toOptionalNumber = (value) => (value === '' || value == null ? undefined : Number(value))

const money = z.number({ error: 'Enter an amount' }).min(0, 'Cannot be negative').max(1000000, 'Too large')
const optionalMoney = money.optional()
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time like 09:30')
const optionalTime = z.union([z.literal(''), time]).optional()
const vehicleType = z.enum(['CAR', 'BIKE', 'HEAVY', 'TAXI', 'TEMPO'], { error: 'Choose a vehicle type' })

// A latitude or longitude typed as text: empty, or a number in range.
const coordinate = (limit, name) =>
  z.string().trim().optional().refine((v) => !v || (Number.isFinite(Number(v)) && Math.abs(Number(v)) <= limit), { message: `${name} must be a number from -${limit} to ${limit}` })

export const locationDetailsSchema = z.object({
  parkingType: z.enum(['NORMAL', 'AIRPORT']),
  lat: coordinate(90, 'Latitude'),
  lng: coordinate(180, 'Longitude'),
  name: z.string().trim().min(2, 'Parking name is required').max(150),
  line1: z.string().trim().min(2, 'Address is required').max(200),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  pincode: z.string().trim().max(10).optional(),
  contactName: z.string().trim().max(100).optional(),
  contactPhone: z.string().trim().max(20).optional(),
  is24x7: z.boolean(),
  open: time,
  close: time,
  car: count,
  bike: count,
  heavy: count,
  taxi: count,
  tempo: count,
  zones: z.string().max(2000).optional(),
  onlineEnabled: z.boolean(),
  onlineNote: z.string().trim().max(300).optional(),
  waitingMinutes: z.number({ error: 'Enter minutes (0 for the standard time)' }).int().min(0).max(4320, 'At most 3 days (4320 minutes)').refine((v) => v === 0 || v >= 5, 'At least 5 minutes, or 0 for the standard time'),
  cancelBeforeMinutes: z.number({ error: 'Enter minutes (0 if customers cannot cancel)' }).int().min(0).max(10080, 'At most 7 days'),
  fee: z.object(Object.fromEntries(['car', 'bike', 'heavy', 'taxi', 'tempo'].map((key) => [key, z.number({ error: 'Enter an amount' }).min(0, 'Cannot be negative').max(100000, 'Too large')]))),
})

export const slotBulkSchema = z.object({
  prefix: z
    .string()
    .trim()
    .max(10)
    .regex(/^[A-Za-z0-9-]*$/, 'Letters, digits and dashes only')
    .optional(),
  start: z.number({ error: 'Enter a number' }).int().min(0).max(99999),
  count: z.number({ error: 'Enter a number' }).int().min(1, 'At least 1').max(500, 'At most 500 at a time'),
  zone: z.string().trim().max(50).optional(),
  floor: z.string().trim().max(50).optional(),
  vehicleType,
  type: z.enum(['NORMAL', 'RESERVED', 'EV', 'ACCESSIBLE', 'VIP']),
})

export const vehicleSchema = z.object({
  plateNumber: z
    .string()
    .trim()
    .refine((v) => /^[A-Za-z0-9]{4,12}$/.test(v.replace(/[\s-]/g, '')), 'Enter 4 to 12 letters and digits'),
  type: vehicleType,
  ownerName: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(20).optional(),
})

export const tariffSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(100),
    vehicleType,
    gracePeriodMinutes: z.number({ error: 'Enter minutes' }).int().min(0).max(1440),
    slabs: z.array(
      z.object({
        uptoMinutes: z.number({ error: 'Enter minutes' }).int('Whole minutes').min(1, 'At least 1').max(1440, 'At most 1440'),
        rate: money,
      }),
    ),
    additionalPerHour: money,
    minimumFee: money,
    maxDailyFee: optionalMoney,
    overnightFee: optionalMoney,
    lostTicketFee: optionalMoney,
    taxPercent: z.number({ error: 'Enter a percentage' }).min(0).max(100),
    taxInclusive: z.boolean(),
    daysOfWeek: z.array(z.string()),
    kind: z.enum(['STANDARD', 'EVENT', 'AIRPORT']),
    eventName: z.string().trim().max(100).optional(),
    priority: z.number({ error: 'Enter a number from 0 to 100' }).int('Whole number').min(0).max(100),
    startTime: optionalTime,
    endTime: optionalTime,
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
    flatFee: optionalMoney,
    longStayAfterMinutes: z.number({ error: 'Enter minutes' }).int('Whole minutes').min(1, 'At least 1').max(100000).optional(),
    longStayDailyRate: optionalMoney,
  })
  .superRefine((data, ctx) => {
    const issue = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message })
    if (!data.slabs.length && !data.additionalPerHour && data.flatFee === undefined) {
      issue('additionalPerHour', 'Add a slab, an hourly rate or a flat fee')
    }
    if (Boolean(data.startTime) !== Boolean(data.endTime)) {
      issue(data.startTime ? 'endTime' : 'startTime', 'Set both times, or neither')
    }
    if (data.startTime && data.startTime === data.endTime) issue('endTime', 'Must be different from the start time')
    if ((data.longStayAfterMinutes === undefined) !== (data.longStayDailyRate === undefined)) {
      issue(data.longStayAfterMinutes === undefined ? 'longStayAfterMinutes' : 'longStayDailyRate', 'Fill in both long-stay fields, or neither')
    }
    if (data.validFrom && data.validTo && data.validTo < data.validFrom) issue('validTo', 'Must be on or after the first date')
    if (data.kind === 'EVENT') {
      if (!data.eventName?.trim()) issue('eventName', 'Give the event a name')
      if (!data.validFrom) issue('validFrom', 'Choose the first day')
      if (!data.validTo) issue('validTo', 'Choose the last day')
    }
    data.slabs.forEach((slab, i) => {
      const previous = data.slabs[i - 1]
      if (!previous) return
      if (slab.uptoMinutes <= previous.uptoMinutes) {
        ctx.addIssue({ code: 'custom', path: ['slabs', i, 'uptoMinutes'], message: 'Must be longer than the slab above' })
      }
      if (slab.rate < previous.rate) {
        ctx.addIssue({ code: 'custom', path: ['slabs', i, 'rate'], message: 'Cannot be less than the slab above' })
      }
    })
  })

export const feePreviewSchema = z
  .object({
    vehicleType,
    entryTime: z.string().min(1, 'Choose the entry time'),
    exitTime: z.string().min(1, 'Choose the exit time'),
    lostTicket: z.boolean(),
  })
  .refine((data) => !data.entryTime || !data.exitTime || new Date(data.exitTime) >= new Date(data.entryTime), {
    path: ['exitTime'],
    message: 'Exit must be after entry',
  })

export const operatorProfileSchema = z.object({
  employeeCode: z.string().trim().max(30).optional(),
  shiftName: z.string().trim().max(50).optional(),
  shiftStart: optionalTime,
  shiftEnd: optionalTime,
})

export const userEditSchema = operatorProfileSchema.extend({
  loginId: loginId.optional(),
  lanes: z.array(z.string()).optional(),
  name: z.string().trim().min(2, 'Name is required').max(100),
  phone: z.string().trim().max(20).optional(),
  role: z.string().min(1, 'Choose a role'),
  locationIds: z.array(z.string()),
  reprint: z.enum(['YES', 'NO']).optional(),
  showEntry: z.enum(['YES', 'NO']).optional(),
  showExit: z.enum(['YES', 'NO']).optional(),
  showTotal: z.enum(['YES', 'NO']).optional(),
})

const plate = z
  .string()
  .trim()
  .refine((v) => /^[A-Za-z0-9]{4,12}$/.test(v.replace(/[\s-]/g, '')), 'Enter 4 to 12 letters and digits')

export const entrySchema = z.object({
  locationId: z.string().min(1, 'Choose a location'),
  vehicleNumber: plate,
  vehicleType,
  gate: z.string().optional(),
})

export const exitLookupSchema = z
  .object({
    locationId: z.string().min(1, 'Choose a location'),
    query: z.string().trim().min(4, 'Enter a ticket number or vehicle number').max(30),
    lostTicket: z.boolean(),
    gate: z.string().optional(),
  })
  .refine((data) => !data.lostTicket || !/^t-?\d{6}/i.test(data.query), {
    path: ['query'],
    message: 'For a lost ticket, enter the vehicle number',
  })

export const reasonSchema = z.object({
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(300),
})

const cash = z.number({ error: 'Enter an amount' }).min(0, 'Cannot be negative').max(100000000, 'Too large')

export const shiftOpenSchema = z.object({
  locationId: z.string().min(1, 'Choose a location'),
  openingCash: cash,
})

export const shiftCloseSchema = z.object({
  closingCash: cash,
  notes: z.string().trim().max(500).optional(),
})

export const leadSchema = z.object({
  name: z.string().trim().min(2, 'Your name is required').max(100),
  email,
  phone: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[0-9+()\-\s]{6,20}$/.test(v), 'Enter a valid phone number')
    .optional(),
  company: z.string().trim().max(150).optional(),
  message: z.string().trim().max(2000, 'At most 2000 characters').optional(),
  website: z.string().optional(),
})

export const faqSchema = z.object({
  question: z.string().trim().min(5, 'Enter the question').max(300),
  answer: z.string().trim().min(5, 'Enter the answer').max(3000),
  category: z.string().trim().min(2, 'Enter a category').max(60),
  order: z.number({ error: 'Enter a number' }).int().min(0).max(10000),
  isPublished: z.boolean(),
})

export const testimonialSchema = z.object({
  quote: z.string().trim().min(10, 'Enter what the customer said').max(600),
  name: z.string().trim().min(2, 'Enter a name').max(100),
  role: z.string().trim().max(100),
  company: z.string().trim().max(150),
  order: z.number({ error: 'Enter a number' }).int().min(0).max(10000),
  isPublished: z.boolean(),
})

export const postSchema = z.object({
  title: z.string().trim().min(5, 'Enter a title').max(200),
  category: z.string().trim().min(2, 'Enter a category').max(60),
  tags: z
    .string()
    .trim()
    .refine((v) => v.split(',').map((t) => t.trim()).filter(Boolean).every((t) => /^[A-Za-z0-9 -]{2,40}$/.test(t)), 'Tags may contain letters, digits, spaces and dashes')
    .refine((v) => v.split(',').filter((t) => t.trim()).length <= 10, 'At most 10 tags')
    .optional(),
  excerpt: z.string().trim().max(400).optional(),
  body: z.string().trim().min(20, 'Write at least a few sentences').max(50000),
  isPublished: z.boolean(),
})

export const profileSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(100, 'At most 100 characters'),
  phone: z
    .string()
    .trim()
    .refine((value) => value === '' || /^[0-9+\-\s()]{6,20}$/.test(value), 'Enter a valid mobile number'),
})

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: password,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from the current one',
  })

// Money part shared by selling and renewing a pass.
const passMoneyShape = {
  locationId: z.string().min(1, 'Choose where the money was taken'),
  unit: z.enum(['DAY', 'WEEK', 'MONTH'], { error: 'Choose days, weeks or months' }),
  count: z.number({ error: 'Enter how long the pass lasts' }).int('Whole numbers only').min(1, 'At least 1'),
  amount: z.number({ error: 'Enter an amount' }).min(0, 'Cannot be negative').max(10000000, 'Too large'),
  method: z.enum(['CASH', 'UPI', 'CARD', 'COMPLIMENTARY'], { error: 'Choose a payment method' }),
  transactionId: z.string().trim().max(100).refine((v) => v === '' || v.length >= 4, 'At least 4 characters').optional(),
}

const PASS_COUNT_MAX = { DAY: 366, WEEK: 156, MONTH: 36 }

const checkPassMoney = (data, ctx) => {
  const max = PASS_COUNT_MAX[data.unit]
  if (max && data.count > max) {
    ctx.addIssue({ code: 'custom', path: ['count'], message: `At most ${max}` })
  }
  if (data.amount > 0 && data.method === 'COMPLIMENTARY') {
    ctx.addIssue({ code: 'custom', path: ['method'], message: 'A free pass has no amount' })
  }
  if (data.amount === 0 && data.method !== 'COMPLIMENTARY') {
    ctx.addIssue({ code: 'custom', path: ['method'], message: 'An amount of 0 is a free pass. Choose Free.' })
  }
  if (data.method === 'CASH' && data.transactionId) {
    ctx.addIssue({ code: 'custom', path: ['transactionId'], message: 'Cash has no reference' })
  }
}

export const passRenewSchema = z.object(passMoneyShape).superRefine(checkPassMoney)

export const passSaleSchema = z
  .object({
    ...passMoneyShape,
    vehicleNumber: z
      .string()
      .trim()
      .refine((v) => /^[A-Za-z0-9]{4,12}$/.test(v.replace(/[\s-]/g, '')), 'Enter 4 to 12 letters and digits'),
    vehicleType,
    holderName: z.string().trim().min(2, 'Holder name is required').max(100),
    phone: z.string().trim().max(20).optional(),
    email: optionalEmail,
    notes: z.string().trim().max(300).optional(),
    startDate: z.string().optional(),
    passType: z.enum(['REGULAR', 'EMPLOYEE', 'RESIDENT', 'VIP', 'CORPORATE']),
    maxVehicles: z.number({ error: 'Enter how many vehicles' }).int('Whole numbers only').min(1, 'At least 1').max(10, 'At most 10'),
  })
  .superRefine(checkPassMoney)

export const roleSchema = z.object({
  name: z.string().trim().min(2, 'Give the role a name').max(60),
  description: z.string().trim().max(300).optional(),
  baseRole: z.string().min(1, 'Choose a base role'),
  permissions: z.array(z.string()),
})

// The holder's contact details on a pass (empty email removes it).
export const passContactSchema = z.object({
  holderName: z.string().trim().min(2, 'Holder name is required').max(100),
  phone: z.string().trim().max(20).optional(),
  email: optionalEmail,
})

// Prepaid wallets. Vehicles are typed as one text, separated by commas or spaces.
export const parseVehicles = (text) =>
  String(text || '')
    .split(/[,\n]+/)
    .map((v) => v.trim())
    .filter(Boolean)

export const walletSchema = z
  .object({
    holderName: z.string().trim().min(2, 'Enter the holder\'s name').max(100),
    phone: z.string().trim().max(20).optional(),
    vehicles: z.string().max(200),
    lowBalanceAlert: z.number({ error: 'Enter an amount' }).min(0, 'Cannot be negative').max(100000),
    notes: z.string().trim().max(300).optional(),
  })
  .superRefine((data, ctx) => {
    const list = parseVehicles(data.vehicles)
    if (list.length > 5) ctx.addIssue({ code: 'custom', path: ['vehicles'], message: 'At most 5 vehicles' })
    if (list.some((v) => !/^[A-Za-z0-9]{4,12}$/.test(v.replace(/[\s-]/g, '')))) {
      ctx.addIssue({ code: 'custom', path: ['vehicles'], message: 'Each vehicle needs 4 to 12 letters and digits' })
    }
  })

export const walletTopUpSchema = z
  .object({
    amount: z.number({ error: 'Enter the amount' }).min(1, 'At least ₹1').max(100000, 'At most ₹1,00,000'),
    method: z.enum(['CASH', 'UPI', 'CARD']),
    reference: z.string().trim().max(100).optional(),
    locationId: z.string().min(1, 'Choose the location'),
  })
  .superRefine((data, ctx) => {
    if (Math.abs(data.amount * 100 - Math.round(data.amount * 100)) > 1e-6) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'At most 2 decimals' })
    }
    if (data.method !== 'CASH' && data.reference && data.reference.length < 4) {
      ctx.addIssue({ code: 'custom', path: ['reference'], message: 'At least 4 characters, or leave empty' })
    }
  })

export const walletAdjustSchema = z.object({
  amount: z
    .number({ error: 'Enter the amount' })
    .min(-100000)
    .max(100000)
    .refine((v) => v !== 0, 'Cannot be zero'),
  reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(300),
})
