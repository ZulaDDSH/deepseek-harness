/**
 * Binds each Workspace icon choice to its glyph from the shared icon library.
 * The map is total over the icon vocabulary, so a choice added without a glyph
 * fails to compile rather than rendering a blank slot, and every reader (row,
 * filter menu, and appearance editor) resolves the same glyph through one import.
 */
import {
  IconFolderOutlineMedium,
  IconWorkspaceCodeOutlineMedium,
  IconTerminalOutlineMedium,
  IconWorkspaceBranchOutlineMedium,
  IconRocketOutlineMedium,
  IconWorkspaceSparkOutlineMedium,
  IconExperimentOutlineMedium,
  IconWorkspaceDatabaseOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceIcon } from '../appearance.ts'

/** The icon-library glyph for one choice. */
export const WORKSPACE_ICON_GLYPHS: Record<WorkspaceIcon, typeof IconFolderOutlineMedium> = {
  folder: IconFolderOutlineMedium,
  code: IconWorkspaceCodeOutlineMedium,
  terminal: IconTerminalOutlineMedium,
  branch: IconWorkspaceBranchOutlineMedium,
  rocket: IconRocketOutlineMedium,
  spark: IconWorkspaceSparkOutlineMedium,
  experiment: IconExperimentOutlineMedium,
  database: IconWorkspaceDatabaseOutlineMedium,
}
