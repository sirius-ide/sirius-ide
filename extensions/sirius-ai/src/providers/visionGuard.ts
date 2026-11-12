/*---------------------------------------------------------------------------------------------
 *  Sirius — images, for a model that can see them
 *  Copyright (c) Clicksora, L.L.C. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import type { ChatMessage } from '../types';

/**
 * Keep images only for models that can see them.
 *
 * Most local models are text-only. Sending them an image block is at best a
 * provider error and at worst silently ignored, so the model answers as if the
 * user attached nothing. Replacing each image with a short note is the honest
 * degradation: the model knows something was attached and can say it cannot
 * view it, rather than confidently describing a screenshot it never received.
 */
export function withVisionGuard(messages: ChatMessage[], canSee: boolean): ChatMessage[] {
	if (canSee) {
		return messages;
	}
	return messages.map(message => {
		const { images, toolResults, ...rest } = message;
		const note = (count: number) =>
			`\n[${count} image${count === 1 ? '' : 's'} attached — this model cannot view images]`;
		const stripped: ChatMessage = { ...rest };
		if (images?.length) {
			stripped.content = (message.content + note(images.length)).trim();
		}
		if (toolResults) {
			stripped.toolResults = toolResults.map(result => {
				const { images: resultImages, ...resultRest } = result;
				return resultImages?.length
					? { ...resultRest, content: (result.content + note(resultImages.length)).trim() }
					: resultRest;
			});
		}
		return stripped;
	});
}
