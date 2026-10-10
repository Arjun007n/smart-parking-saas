import PassUploadPanel from '../../components/pass/PassUploadPanel'
import { PageTitle } from '../../components/pass/ListKit'
import { PM } from '../../components/pass/listState'

// Pass Management > Pass Create (Bulk Upload): the CSV upload on a page of its own, like ismartparking.com.
export default function PassBulkUpload() {
  return (
    <div className="space-y-5">
      <PageTitle title="Pass Create (Bulk Upload)" back={`${PM}/passes`} />
      <PassUploadPanel />
    </div>
  )
}
