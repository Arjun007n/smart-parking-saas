import { useContext } from 'react'
import { ToastContext } from '../context/ToastContext'

// const toast = useToast();  toast({ title: 'Ticket created', tone: 'success' })
export const useToast = () => useContext(ToastContext)
