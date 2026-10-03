import { z } from 'zod'

const email = z.string().trim().min(1, 'Email is required').email('Enter a valid email')
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
const count = z
  .number({ error: 'Enter a number' })
  .int('Enter a whole number')
  .min(0, 'Cannot be negative')
  .max(100000, 'Too large')

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
})

export const registerSchema = z
  .object({
    companyName: z.string().trim().min(2, 'Company name is required').max(150),
    name: z.string().trim().min(2, 'Your name is required').max(100),
    email,
    phone: z.string().trim().max(20).optional(),
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
})

export const userSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(100),
  email,
  phone: z.string().trim().max(20).optional(),
  password,
  role: z.string().min(1, 'Choose a role'),
  locationIds: z.array(z.string()),
  employeeCode: z.string().trim().max(30).optional(),
  shiftName: z.string().trim().max(50).optional(),
  shiftStart: z.union([z.literal(''), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time like 09:30')]).optional(),
  shiftEnd: z.union([z.literal(''), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time like 09:30')]).optional(),
})

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
const vehicleType = z.enum(['CAR', 'BIKE', 'HEAVY'], { error: 'Choose a vehicle type' })

export const locationDetailsSchema = z.object({
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
  zones: z.string().max(2000).optional(),
  gates: z.array(
    z.object({
      name: z.string().trim().min(1, 'Gate name is required').max(50),
      type: z.enum(['ENTRY', 'EXIT', 'BOTH']),
    }),
  ),
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
  })
  .superRefine((data, ctx) => {
    if (!data.slabs.length && !data.additionalPerHour) {
      ctx.addIssue({ code: 'custom', path: ['additionalPerHour'], message: 'Add a slab or an hourly rate' })
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
  name: z.string().trim().min(2, 'Name is required').max(100),
  phone: z.string().trim().max(20).optional(),
  role: z.string().min(1, 'Choose a role'),
  locationIds: z.array(z.string()),
  password: z.union([z.literal(''), password]).optional(),
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
