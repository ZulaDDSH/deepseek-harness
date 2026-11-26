import {existsSync} from 'node:fs'
import {join} from 'node:path'

export function agyCommand(config={}) {
  if(config.command) return config.command
  if(process.platform==='win32' && process.env.LOCALAPPDATA) {
    const installed=join(process.env.LOCALAPPDATA,'agy','bin','agy.exe')
    if(existsSync(installed)) return installed
  }
  return 'agy'
}
