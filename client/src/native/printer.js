// The Bluetooth thermal printer of the phone app. The printer is paired once in the phone's Bluetooth settings; here the
// person picks it from the paired list and the choice is remembered. Printing goes straight to the printer, with no
// print dialog. In a normal browser none of this exists (printerAvailable is false) and the website prints as before.
import { isNative, nativePlugin } from './platform'
import { paperColumns, toBase64 } from './escpos'

export const printerAvailable = isNative

const KEY = 'sp.printer'
const plugin = () => nativePlugin('ThermalPrinter')

// The chosen printer: { address, name, width } (width is the paper, 58 or 80 mm), or null.
export function savedPrinter() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (value && typeof value.address === 'string' && value.address) {
      return { address: value.address, name: String(value.name || 'Printer'), width: paperColumns(Number(value.width)) === 48 ? 80 : 58 }
    }
  } catch {
    // unreadable: treated as "no printer chosen"
  }
  return null
}

export function savePrinter({ address, name, width }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ address, name, width: width === 80 ? 80 : 58 }))
  } catch {
    // The choice is only lost when the app restarts.
  }
}

export function forgetPrinter() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

// What the person sees when something goes wrong. `code` comes from the phone plugin.
const MESSAGES = {
  NO_PRINTER: 'No printer is set up. Open Menu, Printer and choose one.',
  BT_OFF: 'Bluetooth is off. Opening settings...',
  NO_PERMISSION: 'The app may not use Bluetooth. Allow "Nearby devices" for this app in the phone settings.',
  NOT_PAIRED: 'This printer is no longer paired. Pair it in the phone settings, then choose it again.',
  CONNECT_FAILED: 'Could not reach the printer. Check that it is on, close by, and not connected to another phone.',
  NO_BLUETOOTH: 'This phone has no Bluetooth.',
}

export class PrinterError extends Error {
  constructor(code, message) {
    super(message || MESSAGES[code] || 'The printer did not respond.')
    this.name = 'PrinterError'
    this.code = code
  }
}

const asPrinterError = (error) => {
  if (error instanceof PrinterError) return error
  const code = typeof error?.code === 'string' && MESSAGES[error.code] ? error.code : 'CONNECT_FAILED'
  return new PrinterError(code)
}

// { supported, enabled, allowed } about the phone's Bluetooth.
export async function bluetoothStatus() {
  if (!printerAvailable) return { supported: false, enabled: false, allowed: false }
  return plugin().status()
}

export async function requestBluetooth() {
  return plugin().requestAccess()
}

export async function openBluetoothSettings() {
  try {
    await plugin().openSettings()
  } catch {
    // nothing more to do
  }
}

// The printers already paired with this phone: [{ address, name, printer }]. `printer` is true for devices the phone
// itself calls a printer; the list also holds other paired devices because some printers do not announce what they are.
export async function pairedDevices() {
  const status = await requestBluetooth()
  if (!status.supported) throw new PrinterError('NO_BLUETOOTH')
  if (!status.allowed) throw new PrinterError('NO_PERMISSION')
  if (!status.enabled) {
    openBluetoothSettings()
    throw new PrinterError('BT_OFF')
  }
  const { devices } = await plugin().pairedDevices()
  return [...devices].sort((a, b) => Number(b.printer) - Number(a.printer) || a.name.localeCompare(b.name))
}

// Sends the bytes (from escpos.js) to the chosen printer. Throws a PrinterError with a message fit for the screen.
export async function printBytes(bytes, printer = savedPrinter()) {
  if (!printerAvailable) throw new PrinterError('NO_PRINTER', 'Printing from the phone works only in the Smart Parking app.')
  if (!printer) throw new PrinterError('NO_PRINTER')
  try {
    const status = await requestBluetooth()
    if (!status.supported) throw new PrinterError('NO_BLUETOOTH')
    if (!status.allowed) throw new PrinterError('NO_PERMISSION')
    if (!status.enabled) {
      openBluetoothSettings()
      throw new PrinterError('BT_OFF')
    }
    await plugin().print({ address: printer.address, data: toBase64(bytes) })
  } catch (error) {
    throw asPrinterError(error)
  }
}

// True when the phone app can print and a printer was chosen: then tickets and bills go to the printer by themselves.
export const phonePrintReady = () => printerAvailable && savedPrinter() !== null
