/**
 * Binds each Workspace icon choice to its glyph from the shared icon library.
 * The map is total over the icon vocabulary, so a choice added without a glyph
 * fails to compile rather than rendering a blank slot, and every reader (row,
 * filter menu, and appearance editor) resolves the same glyph through one import.
 */
import {
  IconFolderOutline16,
  IconWorkspaceCodeOutline16,
  IconTerminalOutline16,
  IconWorkspaceBranchOutline16,
  IconRocketOutline16,
  IconWorkspaceSparkOutline16,
  IconExperimentOutline16,
  IconWorkspaceDatabaseOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceIcon } from '../appearance.ts'

/** The icon-library glyph for one choice. */
export const WORKSPACE_ICON_GLYPHS: Record<WorkspaceIcon, typeof IconFolderOutline16> = {
  folder: IconFolderOutline16,
  code: IconWorkspaceCodeOutline16,
  terminal: IconTerminalOutline16,
  branch: IconWorkspaceBranchOutline16,
  rocket: IconRocketOutline16,
  spark: IconWorkspaceSparkOutline16,
  experiment: IconExperimentOutline16,
  database: IconWorkspaceDatabaseOutline16,
}
