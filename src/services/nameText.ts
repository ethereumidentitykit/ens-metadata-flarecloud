import { initializeFont, measureTextAccurate } from 'adaptive-layout-composer'
import SatoshiBold from '../fonts/Satoshi-Bold.ttf'
import { isMappedEmoji } from './emojiAssets'

// Regional indicators and keycaps are not Extended_Pictographic. Include
// modifiers so an unsupported sequence never falls back to a system font.
const EMOJI_RE = /\p{Extended_Pictographic}|[0-9#*]\uFE0F?\u20E3|\p{Regional_Indicator}{2}|\p{Emoji_Modifier}/u
const TEXT_FEATURES = ['ss01', 'ss03', 'tnum']
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
const MAX_CACHED_WIDTHS = 512
const widths = new Map<string, number>()
let fontReady: Promise<unknown> | undefined

export function ensureNameFont(): Promise<unknown> {
	return fontReady ??= initializeFont(SatoshiBold)
}

export function segmentName(text: string): string[] {
	return Array.from(segmenter.segment(text), ({ segment }) => segment)
}

export function isEmojiGrapheme(grapheme: string): boolean {
	return isMappedEmoji(grapheme) || EMOJI_RE.test(grapheme)
}

export function containsEmoji(text: string): boolean {
	for (const { segment } of segmenter.segment(text)) {
		if (isEmojiGrapheme(segment)) return true
	}
	return false
}

/** Shared by label fitting and SVG positioning. Satoshi text uses the same
 * OpenType features as the generated SVG; each embedded emoji occupies 1em.
 * Widths are cached in em, so trying another font size needs no font shaping.
 * Scripts absent from Satoshi use the composer's existing fallback metrics. */
export async function measureNameText(text: string, fontSize: number): Promise<number> {
	if (!text) return 0
	const cached = widths.get(text)
	if (cached !== undefined) return cached * fontSize
	await ensureNameFont()

	let width = 0
	let run = ''
	const flush = async () => {
		if (!run) return
		width += (await measureTextAccurate(run, 1, 'Satoshi', { features: TEXT_FEATURES })).width
		run = ''
	}
	for (const { segment } of segmenter.segment(text)) {
		if (isEmojiGrapheme(segment)) {
			await flush()
			width += 1
		} else {
			run += segment
		}
	}
	await flush()
	if (widths.size >= MAX_CACHED_WIDTHS) widths.delete(widths.keys().next().value!)
	widths.set(text, width)
	return width * fontSize
}
