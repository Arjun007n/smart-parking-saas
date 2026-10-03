// Turns an axios error into a message that can be shown to the user.
export function errorMessage(error) {
  const data = error?.response?.data
  if (data?.errors?.length) {
    return data.errors.map((e) => `${e.field} ${e.message}`).join('. ')
  }
  if (data?.message) return data.message
  // A failed file download carries its error as a Blob, which cannot be read here.
  if (data instanceof Blob) return 'The download failed. Check the dates and try again.'
  if (error?.code === 'ERR_NETWORK') return 'Cannot reach the server. Is the API running?'
  return 'Something went wrong. Please try again.'
}
