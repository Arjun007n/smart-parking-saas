import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { faqApi } from '../../services/api'
import { DEFAULT_FAQS } from '../../data/site'
import { errorMessage } from '../../utils/errors'
import { usePageTitle } from '../../hooks/usePageTitle'
import { PageHeader } from '../../layouts/PublicLayout'
import { Alert, Field, PageLoader } from '../../components/ui'

export default function Faq() {
  usePageTitle('Frequently asked questions')
  const [search, setSearch] = useState('')
  const { data: published = [], isLoading, error } = useQuery({ queryKey: ['faq'], queryFn: faqApi.list, staleTime: 5 * 60_000 })
  // Until questions are added in Dashboard > Website, the built-in answers are shown.
  const data = published.length > 0 ? published : DEFAULT_FAQS.map((f, i) => ({ ...f, _id: `default-${i}` }))

  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = data.filter((faq) => {
    const text = `${faq.question} ${faq.answer}`.toLowerCase()
    return words.every((word) => text.includes(word))
  })
  const categories = [...new Set(matches.map((f) => f.category))]

  return (
    <>
      <PageHeader title="Frequently asked questions" intro="Answers to the questions we hear most." />
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Field
          label="Search the questions"
          type="search"
          name="faq-search"
          placeholder="For example: tariff, cash, export"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <p className="mt-2 text-sm text-slate-500" role="status">
          {!isLoading && !error && (search ? `${matches.length} of ${data.length} questions match` : `${data.length} questions`)}
        </p>

        {error && <div className="mt-6"><Alert>{errorMessage(error)}</Alert></div>}
        {isLoading ? (
          <PageLoader />
        ) : (
          categories.map((category) => (
            <section key={category} className="mt-10">
              <h2 className="text-xl font-bold text-slate-900">{category}</h2>
              <div className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200">
                {matches.filter((f) => f.category === category).map((faq) => (
                  <details key={faq._id} className="group px-5 py-4" open={Boolean(search)}>
                    <summary className="cursor-pointer list-none font-semibold text-slate-900 marker:hidden">
                      <span className="flex items-start justify-between gap-4">
                        {faq.question}
                        <span aria-hidden="true" className="text-slate-400 group-open:rotate-45">+</span>
                      </span>
                    </summary>
                    <p className="mt-3 whitespace-pre-line text-slate-700">{faq.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          ))
        )}

        {!isLoading && !error && matches.length === 0 && (
          <p className="mt-10 text-slate-600">
            {data.length === 0 ? 'Questions will appear here soon.' : 'No question matches your search.'}
          </p>
        )}

        <p className="mt-12 text-slate-700">
          Did not find your answer?{' '}
          <Link to="/contact" className="font-semibold text-blue-700 hover:underline">Ask us</Link>.
        </p>
      </div>
    </>
  )
}
