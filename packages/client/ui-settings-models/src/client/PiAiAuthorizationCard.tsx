import type { ReactNode } from 'react'
import type { ProviderCardExtrasOwnerProps } from './slot-contract.ts'
import type { AuthorizationOperations } from './authorization-operations.ts'
import type { ModelsSettingsStore } from './store.ts'
import type { en } from './locales.ts'
import { SignInCard } from './SignInCard.tsx'

export interface PiAiAuthorizationCardInjected {
  authorization: AuthorizationOperations
  controller: ModelsSettingsStore
  t: (key: keyof typeof en, params?: Record<string, string>) => string
}

export type PiAiAuthorizationCardProps =
  ProviderCardExtrasOwnerProps & PiAiAuthorizationCardInjected

export function PiAiAuthorizationCard(props: PiAiAuthorizationCardProps): ReactNode {
  const { provider, keyConfigured, authorization, controller, t } = props
  return (
    <SignInCard
      provider={provider.provider}
      displayName={provider.displayName}
      operations={authorization}
      t={t}
      refresh={keyConfigured ? 1 : 0}
      onSignedIn={() => { void controller.load() }}
    />
  )
}
