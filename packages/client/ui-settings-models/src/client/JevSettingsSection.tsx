/** Dedicated Jev configuration using the shared provider editor. */
import { useEffect } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelsSectionInjected } from './ModelsSection.tsx'
import { providerModelOptions } from './ModelsSection.tsx'
import { ProviderEditor } from './ProviderEditor.tsx'
import styles from './ModelsSection.module.css'

/** Render the Jev router settings and credential editor.
 * @param props Models directory, settings operations and localized copy.
 * @returns Jev settings, or the current loading or unavailable status.
 */
export function JevSettingsSection({
  controller, useSnapshot, useCredentialsRevision, operations, schema, t,
}: InjectFace<ModelsSectionInjected>) {
  const state = useSnapshot(value => value)
  const revision = useCredentialsRevision(value => value.revision)
  useEffect(() => { void controller.load() }, [controller])
  const row = state.rows.find(row => row.entry.provider === 'jev-router')
  const namespace = row === undefined ? undefined : state.namespaces.get(row.entry.settingsNs)
  return <div className={styles['section']}>
    <h2 className={styles['title']}>{t('jevTitle')}</h2>
    <p className={styles['intro']}>{t('jevHelp')}</p>
    {state.status === 'error' ? <p role="alert">{state.error}</p> : null}
    {namespace === undefined || row === undefined
      ? <><p>{t(state.status === 'idle' || state.status === 'loading' ? 'jevLoading' : 'jevUnavailable')}</p>
        <Button variant="outline" onClick={() => { void controller.load() }}>{t('retry')}</Button></>
      : <ProviderEditor
        provider={row.entry.provider} displayName={row.entry.displayName} namespace={namespace}
        settingsPath={row.entry.settingsPath} operations={operations} schema={schema} t={t}
        credentialsRevision={revision} readOnly={!state.writable}
        modelOptions={providerModelOptions(state, schema)}
        onCredentialChanged={() => { void controller.load() }}
        onClose={() => { void controller.load() }}
      />}
  </div>
}
