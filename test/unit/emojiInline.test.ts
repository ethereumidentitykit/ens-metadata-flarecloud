import { describe, expect, it } from "vitest";
import { inlineEmojiAsImages } from "../../src/services/emojiInline";

describe("inlineEmojiAsImages", () => {
	it("leaves emoji-free SVG untouched", async () => {
		const svg = '<svg><text x="10" y="50" font-size="20px" fill="white">vitalik.eth</text></svg>';
		const out = await inlineEmojiAsImages(svg);
		expect(out).toBe(svg);
	});
});
