import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { passApi } from '../../services/api'
import { useMyLocations } from '../../hooks/useMyLocations'
import { csvObjects, toCsv } from '../../utils/csv'
import { errorMessage } from '../../utils/errors'
import { Alert, Badge, Button, Card, Select } from '../ui'

const COLUMNS = ['holderName', 'phone', 'email', 'vehicleNumber', 'vehicleType', 'passType', 'startDate', 'unit', 'count', 'amount', 'method', 'company', 'notes']
const REQUIRED = ['holderName', 'vehicleNumber', 'vehicleType']
const MAX_ROWS = 200

const TEMPLATE = toCsv([
  COLUMNS,
  ['Asha Verma', '9876543210', 'asha@example.com', 'MP04AB1234', 'CAR', 'EMPLOYEE', '2026-11-01', 'MONTH', '1', '1500', 'CASH', 'Acme Pvt Ltd', ''],
])

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'pass-upload-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// Sell many passes from a CSV file: choose the file, check the rows, upload. Each row is a normal sale.
export default function PassUploadPanel() {
  const { locations, defaultId } = useMyLocations()
  const [chosenLocation, setChosenLocation] = useState('')
  const locationId = chosenLocation || defaultId || (locations[0] ? locations[0]._id : '')
  const queryClient = useQueryClient()
  const [rows, setRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [problem, setProblem] = useState('')

  const upload = useMutation({
    mutationFn: () => passApi.bulkUpload({ locationId, rows }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['passes'] })
      queryClient.invalidateQueries({ queryKey: ['pass-summary'] })
      queryClient.invalidateQueries({ queryKey: ['pass-users'] })
      queryClient.invalidateQueries({ queryKey: ['pass-vehicles'] })
    },
  })

  const onFile = async (event) => {
    const file = event.target.files?.[0]
    upload.reset()
    setRows([])
    setProblem('')
    setFileName(file ? file.name : '')
    if (!file) return
    if (file.size > 1024 * 1024) {
      setProblem('This file is too large. Upload at most 200 passes at a time.')
      return
    }
    const { rows: parsed, missing } = csvObjects(await file.text(), COLUMNS)
    const missingRequired = missing.filter((m) => REQUIRED.includes(m))
    if (missingRequired.length) {
      setProblem(`The file needs these columns: ${missingRequired.join(', ')}. Download the template to see them all.`)
      return
    }
    if (parsed.length === 0) {
      setProblem('The file has no rows.')
      return
    }
    if (parsed.length > MAX_ROWS) {
      setProblem(`The file has ${parsed.length} rows. Upload at most ${MAX_ROWS} at a time.`)
      return
    }
    setRows(parsed)
  }

  const result = upload.data
  const failedByRow = new Map((result?.results || []).map((r) => [r.row, r]))
  const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)

  return (
    <Card title="Bulk pass upload">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Sell many passes from a CSV file, for example a company&apos;s staff. Each row is a normal sale: money is recorded in your open shift
          at the location below, and a row that cannot be sold (a vehicle that already has a pass, a company not in the master) fails alone with its reason.
          Up to {MAX_ROWS} rows at a time. An amount of 0 makes a free pass.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          {locations.length > 1 && (
            <Select className="w-64" label="Sell at location" name="upload-location" value={locationId} onChange={(e) => setChosenLocation(e.target.value)}>
              {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </Select>
          )}
          <Button type="button" variant="secondary" onClick={downloadTemplate}>Download template</Button>
          <label className="text-sm font-medium text-slate-700">
            CSV file
            <input className="mt-1 block text-sm" type="file" accept=".csv,text/csv" onChange={onFile} />
          </label>
        </div>

        {problem && <Alert>{problem}</Alert>}
        {upload.error && <Alert>{errorMessage(upload.error)}</Alert>}

        {rows.length > 0 && (
          <>
            <p className="text-sm text-slate-700">
              {fileName}: {rows.length} rows, {total.toLocaleString('en-IN')} rupees in total.
            </p>
            <div className="max-h-96 overflow-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="sticky top-0 bg-white text-slate-500">
                  <tr>
                    <th className="pb-2 pr-3 font-medium">#</th>
                    <th className="pb-2 pr-3 font-medium">Holder</th>
                    <th className="pb-2 pr-3 font-medium">Vehicle</th>
                    <th className="pb-2 pr-3 font-medium">Type</th>
                    <th className="pb-2 pr-3 font-medium">Term</th>
                    <th className="pb-2 pr-3 font-medium">Amount</th>
                    <th className="pb-2 pr-3 font-medium">Company</th>
                    <th className="pb-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const outcome = failedByRow.get(i + 1)
                    return (
                      <tr key={`${r.vehicleNumber}-${i}`} className="border-t border-slate-200">
                        <td className="py-1.5 pr-3 text-slate-500">{i + 1}</td>
                        <td className="py-1.5 pr-3">{r.holderName}</td>
                        <td className="py-1.5 pr-3 font-medium">{r.vehicleNumber}</td>
                        <td className="py-1.5 pr-3">{r.vehicleType}</td>
                        <td className="py-1.5 pr-3">{r.count || 1} {(r.unit || 'MONTH').toLowerCase()}</td>
                        <td className="py-1.5 pr-3">{r.amount || 0}</td>
                        <td className="py-1.5 pr-3">{r.company || '—'}</td>
                        <td className="py-1.5">
                          {outcome ? (outcome.ok ? <Badge tone="green">Sold {outcome.passNumber}</Badge> : <span className="text-red-700">{outcome.error}</span>) : <span className="text-slate-400">Not uploaded yet</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {result ? (
              <Alert type={result.failed ? 'info' : 'success'}>
                {result.created} passes sold{result.failed ? `, ${result.failed} not sold (see the reasons above). Fix those rows in the file and upload only them.` : '.'}
              </Alert>
            ) : (
              <Button loading={upload.isPending} disabled={!locationId} onClick={() => upload.mutate()}>Sell {rows.length} passes</Button>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
