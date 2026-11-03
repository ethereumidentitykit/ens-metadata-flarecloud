declare module 'adaptive-layout-composer' {
	export type TextMeasurementOptions = { features?: string[] }
	export type SVGImageOptions = {
		layout: 'ens-v2'
		text: string
		width: number
		height: number
		fontFamily: string
		backgroundImageUrl?: string | null
		backgroundMarkup?: string | null
		colors: { label: string; accent: string; logo: string; parent: string }
		measureText?: (text: string, fontSize: number, options: TextMeasurementOptions) => number | Promise<number>
	}
	export function createDynamicSVGImage(options: SVGImageOptions): Promise<Uint8Array>
	export function initializeFont(font: ArrayBuffer): Promise<unknown>
	export function measureTextAccurate(text: string, fontSize: number, fontFamily: string, options?: TextMeasurementOptions): Promise<{ width: number }>
}
