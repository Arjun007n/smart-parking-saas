import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { blogApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { usePageTitle } from '../../hooks/usePageTitle'
import { Alert, PageLoader } from '../../components/ui'

const dateFormat = new Intl.DateTimeFormat('en-IN', { dateStyle: 'long' })

// Article text is plain text: blank lines separate paragraphs and a line
// starting with "## " is a heading. It is shown as text, never as HTML.
function Body({ text }) {
  const blocks = text.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean)
  return blocks.map((block, i) =>
    block.startsWith('## ') ? (
      // Blocks have no ids; their order never changes for one article.
      <h2 key={i} className="mt-10 text-2xl font-bold text-slate-900">{block.slice(3)}</h2>
    ) : (
      <p key={i} className="mt-5 whitespace-pre-line text-lg leading-relaxed text-slate-700">{block}</p>
    ),
  )
}

export default function BlogPost() {
  const { slug } = useParams()
  const { data: post, isLoading, error } = useQuery({
    queryKey: ['blog-post', slug],
    queryFn: () => blogApi.get(slug),
    retry: false,
    // Reading an article counts a view, so do not refetch it in the background.
    staleTime: Infinity,
  })
  usePageTitle(post ? post.title : 'Blog')

  if (isLoading) return <PageLoader />

  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <Link to="/blog" className="text-sm font-semibold text-blue-700 hover:underline">← All articles</Link>

      {error ? (
        <div className="mt-6">
          <Alert>{error.response?.status === 404 ? 'This article does not exist or is no longer published.' : errorMessage(error)}</Alert>
        </div>
      ) : (
        <>
          <p className="mt-6 text-xs font-medium uppercase tracking-wide text-slate-500">{post.category}</p>
          <h1 className="mt-2 text-3xl font-bold leading-tight text-slate-900 sm:text-4xl">{post.title}</h1>
          <p className="mt-3 text-sm text-slate-500">
            {post.author ? `${post.author} · ` : ''}
            {post.publishedAt ? dateFormat.format(new Date(post.publishedAt)) : ''} · {post.views} view{post.views === 1 ? '' : 's'}
          </p>

          <Body text={post.body} />

          {post.tags.length > 0 && (
            <ul className="mt-10 flex flex-wrap gap-2" aria-label="Tags">
              {post.tags.map((tag) => (
                <li key={tag}>
                  <Link to={`/blog?tag=${encodeURIComponent(tag)}`} className="rounded bg-slate-100 px-2 py-1 text-sm text-slate-700 hover:bg-slate-200">
                    #{tag}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  )
}
