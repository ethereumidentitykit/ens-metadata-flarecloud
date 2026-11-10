import manifest from '../assets/apple-emoji/manifest.json'

type EmojiEntry = readonly [offset: number, byteLength: number, width: number, height: number]
const entries: Readonly<Record<string, readonly number[]>> = manifest
const MAX_CACHED_BYTES = 2 * 1024 * 1024
const dataUrls = new Map<number, string>()
let cachedBytes = 0
let payload: Promise<ArrayBuffer> | undefined

function entryFor(grapheme: string): EmojiEntry | undefined {
	// ENS normalization removes FE0F; display beautification restores it.
	const key = grapheme.replace(/\uFE0F/g, '')
	return Object.hasOwn(entries, key) ? entries[key] as EmojiEntry : undefined
}

export function isMappedEmoji(grapheme: string): boolean {
	return entryFor(grapheme) !== undefined
}

/** Return bundled PNG bytes as an image URL; never uses a font or network fallback. */
export async function getEmojiDataUrl(grapheme: string): Promise<string | null> {
	const entry = entryFor(grapheme)
	if (!entry) return null
	const [offset, byteLength] = entry
	const cached = dataUrls.get(offset)
	if (cached !== undefined) {
		dataUrls.delete(offset)
		dataUrls.set(offset, cached)
		return cached
	}

	// The 13 MB binary module is only loaded when an emoji is actually needed.
	// Share the in-flight import across concurrent cards in this Worker isolate.
	payload ??= import('../assets/apple-emoji/images.bin').then(module => module.default)
	const buffer = await payload
	// Concurrent requests waiting for the same module reuse the first encoding.
	const ready = dataUrls.get(offset)
	if (ready !== undefined) return ready
	const bytes = new Uint8Array(buffer, offset, byteLength)
	let binary = ''
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
	}
	const url = `data:image/png;base64,${btoa(binary)}`
	// Bound retained base64 data independently of the immutable binary module.
	// UTF-16 accounting is conservative even on engines storing ASCII compactly.
	const cost = url.length * 2
	while (dataUrls.size && cachedBytes + cost > MAX_CACHED_BYTES) {
		const oldest = dataUrls.entries().next().value!
		dataUrls.delete(oldest[0])
		cachedBytes -= oldest[1].length * 2
	}
	if (cost <= MAX_CACHED_BYTES) {
		dataUrls.set(offset, url)
		cachedBytes += cost
	}
	return url
}
