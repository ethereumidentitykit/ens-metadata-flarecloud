import { ens_normalize } from '@adraffy/ens-normalize'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import type { Env } from '../env'
import { respondFromCache } from '../lib/responseCache'
import { ErrorSchema } from '../schemas'

export const defaultNameImageRoutes = new OpenAPIHono<{ Bindings: Env }>({
	defaultHook: (result, c) => {
		if (!result.success) {
			c.header('cache-control', 'no-store')
			return c.json({ error: 'bad_request', message: 'name or label must contain 1–1024 characters' }, 400)
		}
	},
})

const PathParams = z.object({
	label: z.string().min(1).max(1024).openapi({
		param: { name: 'label', in: 'path' },
		example: 'plaincheese',
		description: 'URL-encoded ENS label or full name, including subnames (at most 1024 UTF-16 code units). Bare labels receive an .eth suffix.',
	}),
})
const BadRequestResponse = {
	description: 'Invalid ENS name or label, or input too long',
	content: { 'application/json': { schema: ErrorSchema } },
}

const svgRoute = createRoute({
	method: 'get',
	path: '/v2/image/{label}',
	tags: ['metadata'],
	summary: 'Render a default ENSv2 image as SVG',
	description:
		'Normalizes an ENS name or label, appends .eth to bare labels, and renders the neutral V2 SVG with its font embedded. Does not fetch metadata, avatars, ownership, or registration status. No chain, contract, or token ID is needed. Clients can apply registration-status colors using the SVG palette IDs. Cached for one day.',
	request: { params: PathParams },
	responses: {
		200: {
			description: 'Self-contained default V2 SVG',
			content: { 'image/svg+xml': { schema: z.string() } },
		},
		400: BadRequestResponse,
	},
})

const pngRoute = createRoute({
	method: 'get',
	path: '/v2/image/{label}/png',
	tags: ['metadata'],
	summary: 'Render a default ENSv2 image as PNG',
	description:
		'Normalizes an ENS name or label, appends .eth to bare labels, and rasterizes the neutral V2 card as a 518×518 PNG. Does not fetch metadata, avatars, ownership, or registration status. Unicode and emoji may fetch font or Twemoji assets. Cached for one day.',
	request: { params: PathParams },
	responses: {
		200: {
			description: 'Default V2 PNG',
			content: { 'image/png': { schema: z.string() } },
		},
		400: BadRequestResponse,
	},
})

async function renderDefaultImage(
	c: Context<{ Bindings: Env }>,
	input: string,
	format: 'svg' | 'png',
): Promise<Response> {
	let name: string
	try {
		const normalized = ens_normalize(input)
		if (!normalized) throw new Error('empty name')
		name = normalized.includes('.') ? normalized : `${normalized}.eth`
	} catch {
		c.header('cache-control', 'no-store')
		return c.json({ error: 'bad_request', message: 'expected a valid ENS name or label' }, 400)
	}

	return respondFromCache(caches.default, c.req.raw, c.executionCtx, async () => {
		// This route deliberately calls the pure renderer directly: token identity
		// and avatar resolution belong only to the token-backed image routes.
		const { renderNameImageV2 } = await import('../services/nameImageV2')
		const svg = await renderNameImageV2({ name })
		let body: string | ArrayBuffer
		if (format === 'png') {
			const { rasterizeNameImageSvg } = await import('../services/rasterize')
			const png = await rasterizeNameImageSvg(svg)
			body = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer
		} else {
			const { embedSatoshiFont } = await import('../services/nameImage')
			body = embedSatoshiFont(svg)
		}
		return new Response(body, {
			headers: {
				'content-type': format === 'png' ? 'image/png' : 'image/svg+xml',
				'cache-control': 'public, max-age=86400',
			},
		})
	})
}

defaultNameImageRoutes.openapi(svgRoute, c => renderDefaultImage(c, c.req.valid('param').label, 'svg') as never)
defaultNameImageRoutes.openapi(pngRoute, c => renderDefaultImage(c, c.req.valid('param').label, 'png') as never)
