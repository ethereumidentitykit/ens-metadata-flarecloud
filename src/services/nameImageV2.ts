import { ens_beautify, ens_normalize } from '@adraffy/ens-normalize'
import { generateIdenticon } from '@ensdomains/etherloom'
import { createDynamicSVGImage } from 'adaptive-layout-composer'
import { namehash } from 'viem/ens'
import { inlineEmojiAsImages } from './emojiInline'
import { containsEmoji, ensureNameFont, measureNameText, segmentName } from './nameText'

// ENS's v2 card is maintained in a separate repository from the v1 service:
// https://github.com/ensdomains/metadata-service-v2/blob/1d022b72b9fd445e82d6b90f6658433de2871190/src/services/image.ts
// The pinned, MIT-licensed composer supplies the official label/logo layout;
// Etherloom supplies the namehash-seeded weave. Keep these design values in
// sync with upstream and the palette IDs used by Grails' expired-name cards.
const DESIGN_SIZE = 550
const IMAGE_SIZE = 518
const PALETTE = {
	'ens-v2-card': '#FAF9F6',
	'ens-v2-accent': '#353535',
	'ens-v2-weave-primary': '#C6C7C4',
	'ens-v2-weave-secondary': '#e3e3e2',
} as const
const SAFE_AVATAR_RE = /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]*={0,2}$/

// Retain the exported helper for existing callers while all renderers share
// the same glyph widths and emoji advances.
export const measureV2Text = measureNameText

// The pinned composer ends at a 14-unit step (13.125px Satoshi), leaving
// 28 rows inside its 418-unit label area after 24 units of vertical padding.
// Use its narrower international-text width and safety margin for every name.
const MIN_LAYOUT_FONT_SIZE = 14 * 60 / 64
const MIN_LAYOUT_TEXT_WIDTH = 390 * 0.85 * 0.9
const MAX_LAYOUT_ROWS = Math.floor((508 - 90 - 24) / 14)

async function minimumRows(text: string, limit = MAX_LAYOUT_ROWS): Promise<number> {
	if (await measureNameText(text, MIN_LAYOUT_FONT_SIZE) <= MIN_LAYOUT_TEXT_WIDTH) return 1
	let rows = 1
	let line = ''
	for (const grapheme of segmentName(text)) {
		const candidate = line + grapheme
		if (line && await measureNameText(candidate, MIN_LAYOUT_FONT_SIZE) > MIN_LAYOUT_TEXT_WIDTH) {
			if (++rows > limit) return rows
			line = grapheme
		} else {
			line = candidate
		}
	}
	return rows
}

async function ellipsizeToRows(text: string, rows: number): Promise<string> {
	if (await minimumRows(text, rows) <= rows) return text
	const graphemes = segmentName(text)
	const suffix = text.slice(text.lastIndexOf('.'))
	// Preserve the TLD (or the sublabel's final dot) whenever it fits. Very long
	// non-.eth suffixes can themselves need abbreviation, retaining their end.
	const suffixLength = text.includes('.') && await minimumRows(`x…${suffix}`, rows) <= rows
		? segmentName(suffix).length : 1
	const shorten = (retained: number) => {
		const tail = Math.max(suffixLength, Math.floor(retained / 2))
		return graphemes.slice(0, retained - tail).join('') + '…' + graphemes.slice(-tail).join('')
	}
	let low = suffixLength + 1
	let high = graphemes.length - 1
	let best = shorten(low)
	while (low <= high) {
		const retained = Math.floor((low + high) / 2)
		const candidate = shorten(retained)
		if (await minimumRows(candidate, rows) <= rows) {
			best = candidate
			low = retained + 1
		} else {
			high = retained - 1
		}
	}
	return best
}

/** The composer wraps graphemes safely but cannot fit unlimited ancestry at
 * its minimum font size. Abbreviate display text only when that final layout
 * would overflow; the complete canonical name still determines the weave.
 * Normal names need only one cached width measurement, with no render retry. */
export async function fitV2DisplayName(display: string): Promise<string> {
	const labels = display.split('.')
	const segments = labels.length <= 2
		? [display]
		: [...labels.slice(0, -2).map(label => `${label}.`), labels.slice(-2).join('.')]
	let total = 0
	for (const segment of segments) {
		total += await minimumRows(segment, MAX_LAYOUT_ROWS - total)
		if (total > MAX_LAYOUT_ROWS) break
	}
	if (total <= MAX_LAYOUT_ROWS) return display

	// The first label identifies the leaf, the last segment the registrable
	// root. Mark omitted middle ancestry explicitly instead of silently dropping it.
	const abbreviated = segments.length > 2
		? [segments[0]!, '….', segments[segments.length - 1]!]
		: segments
	const budgets = await Promise.all(abbreviated.map(segment => minimumRows(segment)))
	let remaining = budgets.reduce((sum, rows) => sum + rows, 0)
	while (remaining > MAX_LAYOUT_ROWS) {
		const index = budgets.indexOf(Math.max(...budgets))
		budgets[index] = budgets[index]! - 1
		remaining--
	}
	return (await Promise.all(abbreviated.map((segment, index) =>
		ellipsizeToRows(segment, budgets[index]!)))).join('')
}

function weaveBackground(name: string): string {
	const weave = generateIdenticon({ namehash: namehash(name) }, PALETTE['ens-v2-weave-primary'], {
		width: DESIGN_SIZE,
		height: DESIGN_SIZE,
		cellSize: 45,
		padding: 8,
		backgroundColor: PALETTE['ens-v2-card'],
	})
	// Etherloom rounds its canvas up to complete cells. Crop, rather than
	// scaling that larger canvas, exactly as the official metadata service does.
	const inner = weave.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
	return `<svg width="${IMAGE_SIZE}" height="${IMAGE_SIZE}" viewBox="0 0 ${DESIGN_SIZE} ${DESIGN_SIZE}">${inner}</svg>`
		+ `<rect width="${IMAGE_SIZE}" height="${IMAGE_SIZE}" fill="${PALETTE['ens-v2-card']}" opacity="0.5"/>`
}

/** Render a normalized ENS v2 name. Invalid names are handled by the v1
 * warning card in nameImage.ts, before this renderer is called. */
export async function renderNameImageV2({ name, avatarDataUrl }: {
	name: string
	avatarDataUrl?: string
}): Promise<string> {
	await ensureNameFont()
	const canonical = ens_normalize(name)
	const display = await fitV2DisplayName(ens_beautify(canonical))
	const avatar = avatarDataUrl && SAFE_AVATAR_RE.test(avatarDataUrl) ? avatarDataUrl : null
	const bytes = await createDynamicSVGImage({
		layout: 'ens-v2',
		text: display,
		width: IMAGE_SIZE,
		height: IMAGE_SIZE,
		fontFamily: 'Satoshi',
		colors: {
			accent: PALETTE['ens-v2-accent'],
			label: PALETTE['ens-v2-card'],
			logo: PALETTE['ens-v2-card'],
			parent: PALETTE['ens-v2-weave-primary'],
		},
		backgroundImageUrl: avatar,
		backgroundMarkup: avatar ? null : weaveBackground(canonical),
		...(containsEmoji(display) ? { measureText: measureNameText } : {}),
	})
	let svg = new TextDecoder().decode(bytes)
	// Solid gradients preserve identical rendering in SVG and resvg while
	// providing explicit palette hooks for Grails' available/premium variants.
	for (const [id, color] of Object.entries(PALETTE)) {
		svg = svg.replaceAll(`fill="${color}"`, `fill="url(#${id})"`)
	}
	const gradients = Object.entries(PALETTE)
		.map(([id, color]) => `<linearGradient id="${id}"><stop stop-color="${color}"/></linearGradient>`)
		.join('')
	const card = svg
		.replace('<svg ', `<svg data-ens-version="2" data-ens-v2-background="${avatar ? 'avatar' : 'weave'}" `)
		.replace('<defs>', `<defs>${gradients}<style>text{font-kerning:normal}</style>`)
	return inlineEmojiAsImages(card)
}
