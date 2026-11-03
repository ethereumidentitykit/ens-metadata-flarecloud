import { ens_beautify, ens_normalize } from '@adraffy/ens-normalize'
import { generateIdenticon } from '@ensdomains/etherloom'
import { createDynamicSVGImage, initializeFont, measureTextAccurate } from 'adaptive-layout-composer'
import { namehash } from 'viem/ens'
import SatoshiBold from '../fonts/Satoshi-Bold.ttf'

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
const TEXT_FEATURES = ['ss01', 'ss03', 'tnum']
const EMOJI_RE = /\p{Extended_Pictographic}|[0-9#*]\uFE0F?\u20E3|\p{Regional_Indicator}{2}/u
const SAFE_AVATAR_RE = /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]*={0,2}$/
let fontReady: Promise<unknown> | undefined

function ensureFont(): Promise<unknown> {
	return fontReady ??= initializeFont(SatoshiBold)
}

/** Match the square emoji images used by our PNG renderer while retaining
 * the composer's Satoshi metrics and kerning for each surrounding text run. */
export async function measureV2Text(text: string, fontSize: number): Promise<number> {
	await ensureFont()
	let width = 0
	let run = ''
	const flush = async () => {
		if (!run) return
		width += (await measureTextAccurate(run, fontSize, 'Satoshi', { features: TEXT_FEATURES })).width
		run = ''
	}
	for (const { segment } of new Intl.Segmenter().segment(text)) {
		if (EMOJI_RE.test(segment)) {
			await flush()
			width += fontSize
		} else {
			run += segment
		}
	}
	await flush()
	return width
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
	await ensureFont()
	const canonical = ens_normalize(name)
	const display = ens_beautify(canonical)
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
		...(EMOJI_RE.test(display) ? { measureText: measureV2Text } : {}),
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
	return svg
		.replace('<svg ', `<svg data-ens-version="2" data-ens-v2-background="${avatar ? 'avatar' : 'weave'}" `)
		.replace('<defs>', `<defs>${gradients}`)
}
