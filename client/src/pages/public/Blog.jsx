import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { blogApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { usePageTitle } from '../../hooks/usePageTitle'
import { PageHeader } from '../../layouts/PublicLayout'
import { Alert, PageLoader } from '../../components/ui'

const dateFormat = new Intl.DateTimeFormat('en-IN', { dateStyle: 'long' })
const postDate = (value) => (value ? dateFormat.format(new Date(value)) : '')

export default function Blog() {
  usePageTitle('Blog')
  const [params, setParams] = useSearchParams()
  const category = params.get('category') || ''
  const tag = params.get('tag') || ''
  const page = Math.max(1, Number.parseInt(params.get('page'), 10) || 1)

  const query = { ...(category ? { category } : {}), ...(tag ? { tag } : {}), page }
  const { data, isLoading, error } = useQuery({
    queryKey: ['blog', query],
    queryFn: () => blogApi.list(query),
    placeholderData: keepPreviousData,
  })

  // Changing a filter goes back to the first page.
  const filter = (next) => setParams(Object.fromEntries(Object.entries(next).filter(([, value]) => value)))
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const chip = (active) =>
    `rounded-full border px-4 py-1.5 text-sm font-medium ${
      active ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
    }`

  return (
    <>
      <PageHeader title="Blog" intro="Practical notes on running parking operations." />
      <div className="mx-auto max-w-6xl px-4 py-12">
        {error && <Alert>{errorMessage(error)}</Alert>}
        {isLoading ? (
          <PageLoader />
        ) : (
          data && (
            <>
              {data.categories.length > 0 && (
                <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
                  <button type="button" aria-pressed={!category} className={chip(!category)} onClick={() => filter({ tag })}>
                    All
                  </button>
                  {data.categories.map((c) => (
                    <button key={c} type="button" aria-pressed={category === c} className={chip(category === c)} onClick={() => filter({ category: c, tag })}>
                      {c}
                    </button>
                  ))}
                </div>
              )}
              {tag && (
                <p className="mt-4 text-sm text-slate-600">
                  Tagged “{tag}”.{' '}
                  <button type="button" className="font-semibold text-blue-700 hover:underline" onClick={() => filter({ category })}>
                    Clear tag
                  </button>
                </p>
              )}

              {data.posts.length === 0 ? (
                <p className="mt-10 text-slate-600">No articles here yet.</p>
              ) : (
                <ul className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {data.posts.map((post) => (
                    <li key={post._id} className="flex flex-col rounded-xl border border-slate-200 p-6">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{post.category}</p>
                      <h2 className="mt-2 text-lg font-semibold text-slate-900">
                        <Link to={`/blog/${post.slug}`} className="hover:text-blue-700 hover:underline">{post.title}</Link>
                      </h2>
                      {post.excerpt && <p className="mt-2 flex-1 text-sm text-slate-600">{post.excerpt}</p>}
                      <p className="mt-4 text-xs text-slate-500">
                        {postDate(post.publishedAt)} · {post.views} view{post.views === 1 ? '' : 's'}
                      </p>
                      {post.tags.length > 0 && (
                        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Tags">
                          {post.tags.map((t) => (
                            <li key={t}>
                              <button type="button" className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-200" onClick={() => filter({ category, tag: t })}>
                                #{t}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {pages > 1 && (
                <nav aria-label="Pages" className="mt-10 flex items-center justify-center gap-4 text-sm">
                  <button
                    type="button"
                    disabled={page <= 1}
                    className="rounded-lg border border-slate-300 px-4 py-2 font-semibold disabled:opacity-50"
                    onClick={() => filter({ category, tag, page: page > 2 ? String(page - 1) : '' })}
                  >
                    Newer
                  </button>
                  <span>Page {page} of {pages}</span>
                  <button
                    type="button"
                    disabled={page >= pages}
                    className="rounded-lg border border-slate-300 px-4 py-2 font-semibold disabled:opacity-50"
                    onClick={() => filter({ category, tag, page: String(page + 1) })}
                  >
                    Older
                  </button>
                </nav>
              )}
            </>
          )
        )}
      </div>
    </>
  )
}
