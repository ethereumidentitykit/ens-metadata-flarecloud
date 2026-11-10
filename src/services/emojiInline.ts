import { getEmojiDataUrl } from './emojiAssets'
import { containsEmoji, isEmojiGrapheme, measureNameText, segmentName } from './nameText'

// Labels come from our renderers, never arbitrary uploaded SVG. Each line is
// a flat <text> element with explicit x/y/font-size and the shared Satoshi style.
const TEXT_ELEMENT = /<text\b([^>]*)>([\s\S]*?)<\/text>/g
const ATTRIBUTE = /([\w:-]+)="([^"]*)"/g
const LAYOUT_ATTRIBUTES = new Set(['x', 'y', 'font-size', 'text-anchor', 'textLength', 'lengthAdjust'])
const EMOJI_DESCENT = 0.12

// A newer ENS normalizer can accept emoji not present in the pinned artwork.
// Show a deterministic missing-glyph tile, rather than depending on OS fonts or
// fetching another provider during image generation. No text/font in this SVG.
const MISSING_EMOJI = 'data:image/svg+xml;base64,' + btoa(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
	+ '<rect x="5" y="5" width="54" height="54" rx="8" fill="#eee" stroke="#888" stroke-width="3"/>'
	+ '<path d="M22 24a10 10 0 0 1 20 0c0 7-10 7-10 14" fill="none" stroke="#888" stroke-width="5" stroke-linecap="round"/>'
	+ '<circle cx="32" cy="47" r="3" fill="#888"/></svg>',
)

function escapeText(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function decodeText(text: string): string {
	return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, value: string) => {
		if (value[0] === '#') {
			const codepoint = value[1]?.toLowerCase() === 'x'
				? Number.parseInt(value.slice(2), 16) : Number.parseInt(value.slice(1), 10)
			return codepoint <= 0x10ffff && !(codepoint >= 0xd800 && codepoint <= 0xdfff)
				? String.fromCodePoint(codepoint) : entity
		}
		return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[value] ?? entity
	})
}

function numberAttribute(value: string | undefined): number {
	if (!value || !/^-?(?:\d+\.?\d*|\.\d+)(?:px)?$/.test(value)) return NaN
	return Number.parseFloat(value)
}

function coordinate(value: number): string {
	return value.toFixed(3)
}

type Label = {
	full: string
	text: string
	x: number
	y: number
	fontSize: number
	anchor: string
	attributes: string
}

function parseLabel(full: string, rawAttributes: string, content: string): Label | null {
	const text = decodeText(content.trim())
	if (!containsEmoji(text)) return null
	if (content.includes('<')) throw new Error('Emoji labels must use a separate text element per line')
	const attributes = new Map([...rawAttributes.matchAll(ATTRIBUTE)].map(match => [match[1]!, match[2]!]))
	const x = numberAttribute(attributes.get('x'))
	const y = numberAttribute(attributes.get('y'))
	const fontSize = numberAttribute(attributes.get('font-size'))
	if (![x, y, fontSize].every(Number.isFinite) || fontSize <= 0) {
		throw new Error('Emoji labels require finite x/y coordinates and a positive font-size')
	}
	return {
		full, text, x, y, fontSize,
		anchor: attributes.get('text-anchor') ?? 'start',
		attributes: rawAttributes.replace(ATTRIBUTE, (attribute, name: string) =>
			LAYOUT_ATTRIBUTES.has(name) ? '' : attribute).trim(),
	}
}

/** Embed Apple artwork once per distinct image and position complete graphemes
 * using the same advances that fitted the label. No network or system fonts. */
export async function inlineEmojiAsImages(svg: string): Promise<string> {
	const labels: Label[] = []
	for (const match of svg.matchAll(TEXT_ELEMENT)) {
		const label = parseLabel(match[0], match[1]!, match[2]!)
		if (label) labels.push(label)
	}
	if (!labels.length) return svg

	const graphemes = new Set(labels.flatMap(label => segmentName(label.text).filter(isEmojiGrapheme)))
	const assets = new Map(await Promise.all([...graphemes].map(async grapheme =>
		[grapheme, await getEmojiDataUrl(grapheme) ?? MISSING_EMOJI] as const)))
	const symbols = new Map<string, string>()
	const replacements = new Map<string, string>()
	for (const label of labels) {
		let x = label.x
		if (label.anchor === 'middle' || label.anchor === 'end') {
			const width = await measureNameText(label.text, label.fontSize)
			x -= label.anchor === 'middle' ? width / 2 : width
		}
		const runs: string[] = []
		let text = ''
		const flushText = async () => {
			if (!text) return
			const width = await measureNameText(text, label.fontSize)
			// resvg does not apply every Satoshi OpenType feature browsers do.
			// Fix each run to its measured advance so the next emoji cannot drift.
			const fit = width > 0 ? ` textLength="${coordinate(width)}" lengthAdjust="spacingAndGlyphs"` : ''
			runs.push(`<text x="${coordinate(x)}" y="${coordinate(label.y)}" font-size="${label.fontSize}px"${fit}>${escapeText(text)}</text>`)
			x += width
			text = ''
		}
		for (const grapheme of segmentName(label.text)) {
			const asset = assets.get(grapheme)
			if (!asset) {
				text += grapheme
				continue
			}
			await flushText()
			let id = symbols.get(asset)
			if (!id) {
				id = `ens-apple-emoji-${symbols.size}`
				symbols.set(asset, id)
			}
			const y = label.y - label.fontSize * (1 - EMOJI_DESCENT)
			runs.push(`<use href="#${id}" x="${coordinate(x)}" y="${coordinate(y)}" width="${label.fontSize}" height="${label.fontSize}"/>`)
			x += label.fontSize
		}
		await flushText()
		// Move opacity/filter/transform and presentation attributes to the group:
		// they must affect the image glyphs as well as the surviving text runs.
		replacements.set(label.full, `<g data-emoji-line="" ${label.attributes}>${runs.join('')}</g>`)
	}
	const definitions = [...symbols].map(([asset, id]) =>
		`<symbol id="${id}" viewBox="0 0 1 1"><image href="${asset}" width="1" height="1"/></symbol>`).join('')
	return svg.replace(TEXT_ELEMENT, full => replacements.get(full) ?? full)
		.replace(/<\/svg>\s*$/, `<defs>${definitions}</defs></svg>`)
}
