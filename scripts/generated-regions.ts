/**
 * The generated-region grammar: the marker lines that delimit generator-owned
 * Markdown regions, shared by the region-injecting generators.
 */

/** Complete opening marker line: `<!-- BEGIN GENERATED <slug> … -->` (slug captured). */
const GENERATED_REGION_BEGIN_LINE = /^<!-- BEGIN GENERATED (\S+)(?: [^>]*)? -->$/
/** Complete closing marker line: `<!-- END GENERATED <slug> -->` (slug captured). */
const GENERATED_REGION_END_LINE = /^<!-- END GENERATED (\S+) -->$/
/** Loose marker detector: any line that LOOKS like a region marker must parse as one. */
const GENERATED_REGION_MARKER_HINT = /^<!-- (?:BEGIN|END) GENERATED /

/** One generated region: its slug, marker line indices, and text (markers included). */
export interface GeneratedRegion {
  slug: string
  /** Zero-based line index of the BEGIN marker. */
  begin: number
  /** Zero-based line index of the END marker. */
  end: number
  text: string
}

/**
 * Locate every generated region. Regions are line-delimited: a marker occupies
 * its whole line, must be a complete well-formed marker, and the closing slug
 * must match the opener.
 *
 * @param content - Full Markdown document text.
 * @returns The regions in document order.
 * @throws Error on an unopened END, unclosed BEGIN, nested BEGIN, malformed
 *   marker line, or a closing slug that does not match its opener.
 */
export function generatedRegions(content: string): GeneratedRegion[] {
  const lines = content.split('\n')
  const regions: GeneratedRegion[] = []
  let open: { slug: string; begin: number } | null = null
  for (const [index, line] of lines.entries()) {
    const begin = GENERATED_REGION_BEGIN_LINE.exec(line)
    if (begin?.[1]) {
      if (open) throw new Error('generated region BEGIN marker nested inside an open region')
      open = { slug: begin[1], begin: index }
      continue
    }
    const end = GENERATED_REGION_END_LINE.exec(line)
    if (end?.[1]) {
      if (!open) throw new Error('generated region END marker without a BEGIN')
      if (end[1] !== open.slug) throw new Error(`generated region END slug '${end[1]}' does not match its BEGIN slug '${open.slug}'`)
      regions.push({ ...open, end: index, text: lines.slice(open.begin, index + 1).join('\n') })
      open = null
      continue
    }
    if (GENERATED_REGION_MARKER_HINT.test(line)) {
      throw new Error(`malformed generated region marker line: ${JSON.stringify(line)}`)
    }
  }
  if (open) throw new Error('generated region BEGIN marker without an END')
  return regions
}

/**
 * Wrap generated Markdown in the marker lines of one region.
 *
 * @param slug - Region slug, unique within its page.
 * @param body - Region content without markers.
 * @returns The marker-delimited region text.
 */
export function renderGeneratedRegion(slug: string, body: string): string {
  return [`<!-- BEGIN GENERATED ${slug} -->`, body, `<!-- END GENERATED ${slug} -->`].join('\n')
}
