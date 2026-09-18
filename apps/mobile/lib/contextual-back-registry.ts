import { createContext, useContext } from 'react'

type ContextualBackHandler = () => void
export type RegisterContextualBackHandler = (handler: ContextualBackHandler) => () => void

export const ContextualBackHandlerContext = createContext<RegisterContextualBackHandler | undefined>(
  undefined,
)

export function useContextualBackRegistration() {
  return useContext(ContextualBackHandlerContext)
}
