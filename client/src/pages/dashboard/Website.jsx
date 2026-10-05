import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { blogApi, faqApi, leadApi, testimonialApi } from '../../services/api'
import { faqSchema, postSchema, testimonialSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { dateTime } from '../../utils/format'
import { Alert, Badge, Button, Card, Checkbox, Field, PageLoader, Select, Textarea } from '../../components/ui'

const LEAD_STATUS = { NEW: 'New', CONTACTED: 'Contacted', QUALIFIED: 'Qualified', CLOSED: 'Closed' }
const LEAD_TYPE = { CONTACT: 'Contact', DEMO: 'Demo request', PARTNER: 'Partner', PRODUCT: 'Hardware' }

// ---------------------------------------------------------------- leads ----

function LeadCard({ lead }) {
  const queryClient = useQueryClient()
  const update = useMutation({
    mutationFn: (status) => leadApi.update(lead._id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  })

  return (
    <li className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">
            {lead.name} <Badge tone="blue">{LEAD_TYPE[lead.type] || lead.type}</Badge>
          </p>
          <p className="text-sm text-slate-600">
            <a href={`mailto:${lead.email}`} className="text-blue-700 hover:underline">{lead.email}</a>
            {lead.phone ? ` · ${lead.phone}` : ''}
            {lead.company ? ` · ${lead.company}` : ''}
          </p>
          <p className="text-xs text-slate-500">
            {dateTime(lead.createdAt)}{lead.subject ? ` · About: ${lead.subject}` : ''}
          </p>
        </div>
        <Select
          label="Status"
          name={`status-${lead._id}`}
          value={lead.status}
          disabled={update.isPending}
          onChange={(event) => update.mutate(event.target.value)}
        >
          {Object.entries(LEAD_STATUS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
      </div>
      {lead.message && <p className="mt-3 whitespace-pre-line break-words text-sm text-slate-800">{lead.message}</p>}
      {update.error && <p className="mt-2 text-sm text-red-600">{errorMessage(update.error)}</p>}
    </li>
  )
}

function Leads() {
  const [status, setStatus] = useState('')
  const { data, isLoading, error } = useQuery({
    queryKey: ['leads', status],
    queryFn: () => leadApi.list(status ? { status } : {}),
  })

  return (
    <div className="space-y-4">
      <Select label="Show" name="lead-filter" className="max-w-xs" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">All enquiries</option>
        {Object.entries(LEAD_STATUS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </Select>
      {error && <Alert>{errorMessage(error)}</Alert>}
      {isLoading ? (
        <PageLoader />
      ) : data && data.leads.length > 0 ? (
        <>
          <p className="text-sm text-slate-600">{data.total} enquiries · {data.newCount} new</p>
          <ul className="space-y-3">
            {data.leads.map((lead) => (
              <LeadCard key={lead._id} lead={lead} />
            ))}
          </ul>
          {data.total > data.leads.length && <p className="text-sm text-slate-500">Showing the latest {data.leads.length}.</p>}
        </>
      ) : (
        !error && <p className="text-sm text-slate-500">No enquiries yet. Messages from the website's forms appear here.</p>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ FAQ ----

const NEW_FAQ = { question: '', answer: '', category: 'General', order: 0, isPublished: true }

function FaqForm({ faq, onClose }) {
  const queryClient = useQueryClient()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(faqSchema),
    defaultValues: faq
      ? { question: faq.question, answer: faq.answer, category: faq.category, order: faq.order, isPublished: faq.isPublished }
      : NEW_FAQ,
  })
  const save = useMutation({
    mutationFn: (values) => (faq ? faqApi.update(faq._id, values) : faqApi.create(values)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faq-admin'] })
      queryClient.invalidateQueries({ queryKey: ['faq'] })
      onClose()
    },
  })

  return (
    <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-4 rounded-lg bg-slate-50 p-4" noValidate>
      <h3 className="font-semibold text-slate-900">{faq ? 'Edit question' : 'New question'}</h3>
      <Alert>{save.error && errorMessage(save.error)}</Alert>
      <Field label="Question" error={errors.question?.message} {...register('question')} />
      <Textarea label="Answer" rows={4} error={errors.answer?.message} {...register('answer')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" error={errors.category?.message} {...register('category')} />
        <Field label="Position in category" type="number" min="0" hint="Lower numbers come first" error={errors.order?.message} {...register('order', { valueAsNumber: true })} />
      </div>
      <Checkbox label="Published (visible on the website)" {...register('isPublished')} />
      <div className="flex gap-3">
        <Button type="submit" loading={save.isPending}>Save</Button>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  )
}

function Faqs() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(null) // null | 'new' | faq
  const { data = [], isLoading, error } = useQuery({ queryKey: ['faq-admin'], queryFn: faqApi.listAll })
  const remove = useMutation({
    mutationFn: faqApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faq-admin'] })
      queryClient.invalidateQueries({ queryKey: ['faq'] })
    },
  })

  return (
    <div className="space-y-4">
      {editing ? (
        <FaqForm key={editing === 'new' ? 'new' : editing._id} faq={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : (
        <Button onClick={() => setEditing('new')}>Add question</Button>
      )}
      {error && <Alert>{errorMessage(error)}</Alert>}
      {remove.error && <Alert>{errorMessage(remove.error)}</Alert>}
      {isLoading ? (
        <PageLoader />
      ) : data.length === 0 ? (
        <p className="text-sm text-slate-500">No questions yet. Add one, or run "npm run seed:content" in the server folder for a starter set.</p>
      ) : (
        <ul className="divide-y divide-slate-200">
          {data.map((faq) => (
            <li key={faq._id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{faq.question}</p>
                <p className="text-xs text-slate-500">
                  {faq.category} · position {faq.order} · {faq.isPublished ? 'Published' : 'Hidden'}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setEditing(faq)}>Edit</Button>
                <Button variant="danger" onClick={() => window.confirm('Delete this question? This cannot be undone.') && remove.mutate(faq._id)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// --------------------------------------------------------- testimonials ----

const NEW_TESTIMONIAL = { quote: '', name: '', role: '', company: '', order: 0, isPublished: true }

function TestimonialForm({ item, onClose }) {
  const queryClient = useQueryClient()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(testimonialSchema),
    defaultValues: item
      ? { quote: item.quote, name: item.name, role: item.role || '', company: item.company || '', order: item.order, isPublished: item.isPublished }
      : NEW_TESTIMONIAL,
  })
  const save = useMutation({
    mutationFn: (values) => (item ? testimonialApi.update(item._id, values) : testimonialApi.create(values)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['testimonials-admin'] })
      queryClient.invalidateQueries({ queryKey: ['testimonials'] })
      onClose()
    },
  })

  return (
    <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-4 rounded-lg bg-slate-50 p-4" noValidate>
      <h3 className="font-semibold text-slate-900">{item ? 'Edit testimonial' : 'New testimonial'}</h3>
      <Alert>{save.error && errorMessage(save.error)}</Alert>
      <Textarea label="What the customer said" rows={3} hint="Only add real quotes from real customers, with their permission." error={errors.quote?.message} {...register('quote')} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" error={errors.name?.message} {...register('name')} />
        <Field label="Role (optional)" error={errors.role?.message} {...register('role')} />
        <Field label="Company (optional)" error={errors.company?.message} {...register('company')} />
      </div>
      <Field label="Position" type="number" min="0" hint="Lower numbers come first" className="max-w-xs" error={errors.order?.message} {...register('order', { valueAsNumber: true })} />
      <Checkbox label="Published (visible on the website)" {...register('isPublished')} />
      <div className="flex gap-3">
        <Button type="submit" loading={save.isPending}>Save</Button>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  )
}

function Testimonials() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(null)
  const { data = [], isLoading, error } = useQuery({ queryKey: ['testimonials-admin'], queryFn: testimonialApi.listAll })
  const remove = useMutation({
    mutationFn: testimonialApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['testimonials-admin'] })
      queryClient.invalidateQueries({ queryKey: ['testimonials'] })
    },
  })

  return (
    <div className="space-y-4">
      {editing ? (
        <TestimonialForm key={editing === 'new' ? 'new' : editing._id} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : (
        <Button onClick={() => setEditing('new')}>Add testimonial</Button>
      )}
      {error && <Alert>{errorMessage(error)}</Alert>}
      {remove.error && <Alert>{errorMessage(remove.error)}</Alert>}
      {isLoading ? (
        <PageLoader />
      ) : data.length === 0 ? (
        <p className="text-sm text-slate-500">No testimonials yet. The section stays hidden on the home page until you publish one.</p>
      ) : (
        <ul className="divide-y divide-slate-200">
          {data.map((item) => (
            <li key={item._id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-slate-900">“{item.quote}”</p>
                <p className="text-xs text-slate-500">
                  {item.name}{item.role ? `, ${item.role}` : ''}{item.company ? ` · ${item.company}` : ''} · position {item.order} · {item.isPublished ? 'Published' : 'Hidden'}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setEditing(item)}>Edit</Button>
                <Button variant="danger" onClick={() => window.confirm('Delete this testimonial? This cannot be undone.') && remove.mutate(item._id)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ----------------------------------------------------------------- blog ----

const NEW_POST = { title: '', category: 'General', tags: '', excerpt: '', body: '', isPublished: false }
const toTags = (text) => (text || '').split(',').map((t) => t.trim()).filter(Boolean)

function PostForm({ post, onClose }) {
  const queryClient = useQueryClient()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(postSchema),
    defaultValues: post
      ? { title: post.title, category: post.category, tags: post.tags.join(', '), excerpt: post.excerpt || '', body: post.body, isPublished: post.isPublished }
      : NEW_POST,
  })
  const save = useMutation({
    mutationFn: ({ tags, ...values }) => {
      const body = { ...values, tags: toTags(tags) }
      return post ? blogApi.update(post._id, body) : blogApi.create(body)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blog-admin'] })
      queryClient.invalidateQueries({ queryKey: ['blog'] })
      onClose()
    },
  })

  return (
    <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-4 rounded-lg bg-slate-50 p-4" noValidate>
      <h3 className="font-semibold text-slate-900">{post ? 'Edit article' : 'New article'}</h3>
      <Alert>{save.error && errorMessage(save.error)}</Alert>
      <Field label="Title" error={errors.title?.message} {...register('title')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" error={errors.category?.message} {...register('category')} />
        <Field label="Tags" hint="Separate with commas" error={errors.tags?.message} {...register('tags')} />
      </div>
      <Textarea label="Short summary" rows={2} hint="Shown in the article list" error={errors.excerpt?.message} {...register('excerpt')} />
      <Textarea
        label="Article"
        rows={14}
        hint='Leave a blank line between paragraphs. Start a line with "## " to make a heading.'
        error={errors.body?.message}
        {...register('body')}
      />
      <Checkbox label="Published (visible on the website)" {...register('isPublished')} />
      <div className="flex gap-3">
        <Button type="submit" loading={save.isPending}>Save</Button>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  )
}

function Posts() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(null)
  const { data = [], isLoading, error } = useQuery({ queryKey: ['blog-admin'], queryFn: blogApi.listAll })
  const remove = useMutation({
    mutationFn: blogApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blog-admin'] })
      queryClient.invalidateQueries({ queryKey: ['blog'] })
    },
  })

  return (
    <div className="space-y-4">
      {editing ? (
        <PostForm key={editing === 'new' ? 'new' : editing._id} post={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : (
        <Button onClick={() => setEditing('new')}>Write an article</Button>
      )}
      {error && <Alert>{errorMessage(error)}</Alert>}
      {remove.error && <Alert>{errorMessage(remove.error)}</Alert>}
      {isLoading ? (
        <PageLoader />
      ) : data.length === 0 ? (
        <p className="text-sm text-slate-500">No articles yet. Write one, or run "npm run seed:content" in the server folder for three starter articles.</p>
      ) : (
        <ul className="divide-y divide-slate-200">
          {data.map((post) => (
            <li key={post._id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{post.title}</p>
                <p className="text-xs text-slate-500">
                  {post.category} · {post.isPublished ? `Published ${dateTime(post.publishedAt)}` : 'Draft'} · {post.views} views · /blog/{post.slug}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setEditing(post)}>Edit</Button>
                <Button variant="danger" onClick={() => window.confirm(`Delete "${post.title}"? This cannot be undone.`) && remove.mutate(post._id)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const TABS = [
  { key: 'leads', label: 'Enquiries', Panel: Leads },
  { key: 'faq', label: 'FAQ', Panel: Faqs },
  { key: 'blog', label: 'Blog', Panel: Posts },
  { key: 'testimonials', label: 'Testimonials', Panel: Testimonials },
]

// Platform owner's screen for the public website: enquiries and content.
export default function Website() {
  const [tab, setTab] = useState('leads')
  const { Panel } = TABS.find((t) => t.key === tab)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Website</h1>
      <div role="tablist" aria-label="Website sections" className="flex gap-1 border-b border-slate-300">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Card>
        <Panel />
      </Card>
    </div>
  )
}
