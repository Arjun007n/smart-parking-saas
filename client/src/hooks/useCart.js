import { useSyncExternalStore } from 'react'
import { cartStore } from '../utils/cart'

// const { items, count, add, setQty, remove, clear } = useCart()
export function useCart() {
  const items = useSyncExternalStore(cartStore.subscribe, cartStore.getItems, cartStore.getItems)
  return {
    items,
    count: items.reduce((sum, item) => sum + item.qty, 0),
    add: cartStore.add,
    setQty: cartStore.setQty,
    remove: cartStore.remove,
    clear: cartStore.clear,
  }
}
