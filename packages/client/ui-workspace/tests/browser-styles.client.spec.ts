/**
 * WorkspaceBrowser spacing contract, asserted against the CSS text on disk:
 * row fills share the shell's trailing inset, the stable scrollbar counts
 * inside it, and flat, grouped, and search views keep their intended rhythm.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/rows/WorkspaceBrowser.module.css', import.meta.url)), 'utf8')
const rowsCss = readFileSync(fileURLToPath(new URL('../src/client/rows/Rows.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one selector rule, keyed by property with whitespace collapsed.
 * Declaration order and trailing semicolons are normalized away.
 * @param selector - one exact selector, including a leading dot for local classes.
 * @returns the rule's declarations, or undefined when no such rule exists.
 */
function declarationsFrom(source: string, selector: string): Map<string, string> | undefined {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const found = new Map<string, string>()
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
  }
  return found.size === 0 ? undefined : found
}

const declarations = (selector: string): Map<string, string> | undefined => declarationsFrom(css, selector)
const rowDeclarations = (selector: string): Map<string, string> | undefined => declarationsFrom(rowsCss, selector)

describe('WorkspaceBrowser.module.css list', () => {
  const root = declarations('.root')
  const listArea = declarations('.listArea')
  const list = declarations('.list')

  it('is the scrolling region', () => {
    expect(list).toBeDefined()
    expect(list!.get('overflow-y')).toBe('auto')
  })

  it('counts the themed scrollbar inside the shell trailing inset', () => {
    expect(root?.get('--dsh-session-list-edge-inset')).toBe('var(--dsh-sidebar-inline-padding)')
    expect(root?.get('--dsh-session-list-scrollbar-width')).toBe('8px')
    expect(root?.get('--dsh-session-list-scrollbar-offset')).toBe('2px')
    expect(root?.get('padding-right')).toBe('var(--dsh-session-list-edge-inset)')
    expect(listArea?.get('margin-left')).toBe('-4px')
    expect(listArea?.get('padding-left')).toBe('4px')
    expect(listArea?.get('margin-right')).toBe('calc(-1 * var(--dsh-session-list-edge-inset))')
    expect(declarations('.fade')?.get('right')).toBe('var(--dsh-session-list-edge-inset)')
    expect(list?.get('margin-right')).toBe('var(--dsh-session-list-scrollbar-offset)')
    expect(list?.get('margin-left')).toBe('-4px')
    expect(list?.get('padding-left')).toBe('4px')
    expect(list?.get('padding-right')).toBe([
      'calc(',
      'var(--dsh-session-list-edge-inset)',
      '- var(--dsh-session-list-scrollbar-width)',
      '- var(--dsh-session-list-scrollbar-offset)',
      ')',
    ].join(' '))
    expect(declarations('.list::-webkit-scrollbar')).toBeUndefined()
  })

  it('reserves the scrollbar whether or not the list overflows', () => {
    expect(list!.get('scrollbar-gutter')).toBe('stable')
  })

  it('keeps 2px between rows and 4px between workspace groups', () => {
    expect(declarations('.flatList > * + *')?.get('margin-top')).toBe('2px')
    expect(declarations(".searchTree > [role='treeitem'] + [role='treeitem']")?.get('margin-top')).toBe('2px')
    expect(declarations('.groupSection > * + *')?.get('margin-top')).toBe('2px')
    expect(declarations('.groupSection + .groupSection')?.get('margin-top')).toBe('4px')
  })

  it('draws drag targets as a leading chevron joined to the insertion line', () => {
    const listTopMarker = declarations('.listTopDropIndicator')
    const workspaceMarker = declarations('.workspaceDropBefore::before')
    const sessionMarker = rowDeclarations('.sessionRow.dropBefore::before')
    expect(listTopMarker?.get('top')).toBe('-8px')
    expect(listTopMarker?.get('left')).toBe('0')
    expect(workspaceMarker?.get('left')).toBe('0')
    expect(sessionMarker?.get('left')).toBe('0')
    for (const marker of [listTopMarker, workspaceMarker, sessionMarker]) {
      expect(marker?.get('height')).toBe('12px')
      expect(marker?.get('background')).not.toContain('radial-gradient')
      expect(marker?.get('background')).toContain('55deg')
      expect(marker?.get('background')).toContain('125deg')
      expect(marker?.get('background')).toContain('calc(50% - 1px) calc(50% + 1px)')
      expect(marker?.get('background')).toContain('0 0 / 5px 7px')
      expect(marker?.get('background')).toContain('0 5px / 5px 7px')
      expect(marker?.get('background')).toContain('4px 5px / calc(100% - 4px) 2px')
    }
  })

  it('keeps the compact fade, overflow control, search field, and row heights', () => {
    expect(declarations('.fade')?.get('height')).toBe('24px')
    expect(declarations('.sessionOverflowButton')?.get('height')).toBe('28px')
    expect(declarations('.searchExpanded')?.get('height')).toBe('30px')
    expect(rowDeclarations('.projectRow')?.get('height')).toBe('34px')
    expect(rowDeclarations('.sessionRow')?.get('height')).toBe('32px')
    expect(rowDeclarations('.flatSessionRowWithoutStatus .title')?.get('margin-left')).toBe('0')
    expect(rowDeclarations('.searchResultRow')?.get('min-height')).toBe('48px')
    expect(rowDeclarations('.sessionRow.selected')?.get('background'))
      .toBe('var(--dsw-alias-interactive-bg-hover)')
  })

  it('keeps session rows stable while hover changes only action emphasis', () => {
    expect(rowDeclarations('.sessionRow .title')?.get('flex')).toBe('1')
    expect(rowDeclarations('.sessionRow:hover .title')).toBeUndefined()
    expect(rowDeclarations('.projectRow .chevron')?.get('display')).toBe('inline-flex')
    expect(rowDeclarations('.rowActions')?.get('display')).toBe('inline-flex')
    expect(rowDeclarations('.rowActions')?.get('visibility')).toBe('hidden')
  })

  it('pins both rail controls to the shared left anchor during the column slide', () => {
    expect(declarations('.rail .sectionHeader')?.get('justify-content')).toBe('flex-start')
    expect(declarations('.rail .iconButton')?.get('width')).toBe('36px')
    expect(declarations('.rail .search')?.get('width')).toBe('36px')
  })

  it('sizes the header action cap to fit every control it holds', () => {
    // `overflow: hidden` clips the cluster's tail, so an undersized cap hides a
    // control while leaving it in the DOM — invisible to a DOM-only assertion,
    // and to the operator only as a missing button. The cap must cover every
    // member: Add workspace, New section, and View options at 28px each.
    const cap = declarations('.headerActions')?.get('max-width')
    expect(cap).toBeDefined()
    expect(declarations('.headerActions')?.get('overflow')).toBe('hidden')
    const controls = 3
    const button = 28
    const gap = 4
    const needed = controls * button + (controls - 1) * gap
    expect(Number.parseFloat(cap!.replace('px', ''))).toBeGreaterThanOrEqual(needed)
    // Collapsing still animates the same property to zero.
    expect(declarations('.headerActionsHidden')?.get('max-width')).toBe('0')
  })

  it('sizes the Sections pane from its content, not from a share of the region', () => {
    // A percentage max-height makes the pane claim that share even while it
    // holds one row, which leaves the Workspace pane short and a dead gap
    // above the divider. The cap must be an absolute height so the divider
    // follows the last row.
    const cap = declarations('.sectionsPane')?.get('max-height')
    expect(cap).toBeDefined()
    expect(cap).toMatch(/^\d+px$/)
    // The pane must not grow beyond its content in the stacked seat.
    expect(declarations('.sectionsPane')?.get('flex')).toBe('0 1 auto')
    // The Workspace pane takes exactly the leftover space.
    expect(declarations('.workspacePane')?.get('flex')).toBe('1 1 auto')
    expect(declarations('.workspacePane')?.get('min-height')).toBe('0')
    // Overflow is confined to the pane's scroll area.
    expect(declarations('.sectionsScroll')?.get('overflow-y')).toBe('auto')
    expect(declarations('.sectionsScroll')?.get('min-height')).toBe('0')
  })

  it('reserves the themed scrollbar inside the Sections pane like the main list', () => {
    // The two panes sit in one column, so their scrollbars must occupy the
    // same track width and offset or the divider reads as misaligned.
    const pane = declarations('.sectionsScroll')
    const list = declarations('.list')
    expect(pane?.get('margin-right')).toBe('var(--dsh-session-list-scrollbar-offset)')
    expect(pane?.get('margin-right')).toBe(list?.get('margin-right'))
    expect(pane?.get('padding-right')).toBe(list?.get('padding-right'))
    expect(pane?.get('scrollbar-gutter')).toBe('stable')
  })

  it('gives Chat Section blocks the same rhythm as Workspace groups', () => {
    // Sections sit in the same list as Workspace groups, so the 2px row gap
    // and 4px block gap must match or the two projections look like different
    // lists when a section is created.
    expect(declarations('.sectionGroup > * + *')?.get('margin-top')).toBe('2px')
    expect(declarations('.sectionGroup + .sectionGroup')?.get('margin-top')).toBe('4px')
    expect(declarations('.ungroupedBlock > * + *')?.get('margin-top')).toBe('2px')
    // The join fill reuses the row hover alias rather than a literal colour.
    expect(declarations('.sectionJoinActive')?.get('background'))
      .toBe('var(--dsw-alias-interactive-bg-hover)')
    // The join outline rides the same accent every other drop marker uses.
    expect(declarations('.sectionGroup.dropInside')?.get('box-shadow'))
      .toContain('var(--dsw-alias-state-business-primary)')
  })
})
